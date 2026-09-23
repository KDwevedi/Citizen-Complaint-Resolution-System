import type express from "express";
import { asyncRoute } from "../../app/async-route.js";
import { hasTrustedWriteOrigin } from "../../app/request-security.js";
import { config } from "../../infrastructure/config.js";
import {
  ManagedAccountError,
  managedIdentity,
  managedUserLogin,
} from "../managed-accounts/managed-account-service.js";
import { DigitUnavailableError } from "../managed-accounts/digit-user-client.js";
import { syncSubjectTenant } from "../reconciliation/subject-sync.js";
import { currentSession } from "../sessions/current-session.js";
import { saveSelectedIdentityContext } from "../sessions/session-store.js";
import {
  IdentityAdminError,
  readTenantMappingForUrlSlug,
} from "../organizations/organization-service.js";
import type { TenantOption } from "./tenant-directory.js";
import { isActiveDigitTenant } from "./tenant-directory.js";
import { resolveTenantOption, resolveTenantOptions } from "./tenant-options.js";

const URL_SLUG = /^[a-z0-9-]{2,63}$/;

function validUrlSlug(value: string): boolean {
  return URL_SLUG.test(value) && (value.match(/[a-z]/g) || []).length >= 2;
}

function publicTenant({ organizationId: _organizationId, ...tenant }: TenantOption) {
  return tenant;
}

function digitFailure(error: unknown, response: express.Response, message: string) {
  if (error instanceof ManagedAccountError) {
    return response.status(error.status).json({ error: error.message });
  }
  if (error instanceof DigitUnavailableError) {
    console.warn(`${message}:`, error.message);
    return response.status(503).json({ error: message });
  }
  throw error;
}

export function registerAccessContextRoutes(app: express.Application): void {
  // Public route context contains only already-public tenant metadata. It lets
  // every application resolve /{urlSlug}/... before React, MDMS or auth starts
  // without exposing Keycloak Organization ids or using email/membership as a
  // tenant-directory query. Authorization still happens in `_select`.
  app.get("/identity/v1/tenant-contexts/:urlSlug", asyncRoute(async (request, response) => {
    const rawUrlSlug = request.params.urlSlug;
    const urlSlug = (Array.isArray(rawUrlSlug) ? rawUrlSlug[0] : rawUrlSlug)
      .trim()
      .toLowerCase();
    if (!validUrlSlug(urlSlug)) {
      return response.status(404).json({ error: "Tenant route is not available" });
    }
    try {
      const mapping = await readTenantMappingForUrlSlug(urlSlug);
      if (!mapping || !await isActiveDigitTenant(mapping.tenantId)) {
        return response.status(404).json({ error: "Tenant route is not available" });
      }
      return response.json({
        tenant: {
          urlSlug: mapping.urlSlug,
          tenantId: mapping.tenantId,
          rootTenantId: mapping.rootTenantId,
          parentTenantId: mapping.parentTenantId,
          fallbackTenantIds: mapping.fallbackTenantIds,
          name: mapping.name,
        },
      });
    } catch (error) {
      if (error instanceof IdentityAdminError) {
        console.warn("Tenant route resolution failed:", error.message);
        return response.status(503).json({ error: "Tenant routes are temporarily unavailable" });
      }
      return digitFailure(error, response, "Tenant routes are temporarily unavailable");
    }
  }));

  app.get("/identity/v1/tenants", asyncRoute(async (request, response) => {
    const current = await currentSession(request.headers.cookie);
    if (!current) {
      return response.status(401).json({ error: "Invalid or missing identity session" });
    }
    try {
      const tenants = await resolveTenantOptions(current.session.claims, true);
      return response.json({
        tenants: tenants.map(publicTenant),
        selectionRequired: tenants.length > 1,
        onboardingRequired: tenants.length === 0,
      });
    } catch (error) {
      return digitFailure(error, response, "Tenant options are temporarily unavailable");
    }
  }));

  app.post("/identity/v1/contexts/_select", asyncRoute(async (request, response) => {
    if (!hasTrustedWriteOrigin(request)) {
      return response.status(403).json({ error: "Untrusted request origin" });
    }
    const current = await currentSession(request.headers.cookie);
    if (!current) {
      return response.status(401).json({ error: "Invalid or missing identity session" });
    }
    const tenantId = typeof request.body?.tenantId === "string"
      ? request.body.tenantId.trim()
      : "";
    if (!tenantId) return response.status(400).json({ error: "tenantId is required" });

    try {
      const subject = current.session.claims.sub;
      // Only the requested tenant is resolved, and its live Organization
      // membership is what authorizes the switch.
      const selected = await resolveTenantOption(subject, tenantId);
      if (!selected) {
        return response.status(403).json({ error: "Tenant context is not available" });
      }
      const outcome = await syncSubjectTenant(
        subject,
        selected.tenantId,
        current.session.claims.phone_number,
      );
      if (!outcome.account?.active) {
        return response.status(403).json({ error: "Tenant context is not available" });
      }
      const identity = managedIdentity(config.keycloakIssuer, subject, selected.tenantId);
      const login = await managedUserLogin(identity, current.sessionId);
      const saved = await saveSelectedIdentityContext(current.sessionId, {
        organizationId: selected.organizationId,
        organizationAlias: selected.organizationAlias,
        tenantId: selected.tenantId,
        name: selected.name,
      });
      if (!saved) {
        return response.status(401).json({ error: "Identity session expired" });
      }
      return response.json({
        access_token: login.accessToken,
        token_type: "bearer",
        expires_in: Math.max(1, Math.floor((login.expiresAt - Date.now()) / 1000)),
        scope: "read",
        UserRequest: login.user,
      });
    } catch (error) {
      return digitFailure(error, response, "Sign-in context is temporarily unavailable");
    }
  }));
}
