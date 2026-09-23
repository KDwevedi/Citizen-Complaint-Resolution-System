import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Loader } from "@egovernments/digit-ui-components";
import {
  Button as V2Button,
  Card as V2Card,
} from "@egovernments/digit-ui-components-v2";

import Header from "../../../components/Header";
import { setEmployeeDetail, V2LoginShell } from "./login";

const requestJson = async (url, init) => {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers: { Accept: "application/json", ...(init?.headers || {}) },
  });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  return { response, body };
};

const cleanAuthResult = () => {
  const url = new URL(window.location.href);
  url.searchParams.delete("authResult");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
};

const IdentityBffEmployeeLogin = ({ t }) => {
  const location = useLocation();
  const [status, setStatus] = useState("checking");
  const [message, setMessage] = useState("");
  const tenant = window.__digitTenantContext;
  const employeeBase = `/${tenant.appBasePath}/employee`;
  const requestedDestination =
    location.state?.from || new URLSearchParams(location.search).get("from");
  const destination =
    typeof requestedDestination === "string" &&
    (requestedDestination === employeeBase ||
      requestedDestination.startsWith(`${employeeBase}/`) ||
      requestedDestination.startsWith(`${employeeBase}?`))
      ? requestedDestination
      : employeeBase;
  const tr = (key, fallback) => {
    const value = t(key);
    return value === key ? fallback : value;
  };

  const establishTenantSession = async () => {
    setStatus("checking");
    setMessage("");

    const resultId = new URLSearchParams(window.location.search).get("authResult");
    if (resultId) {
      const { response, body } = await requestJson(
        `/identity/v1/auth-results/${encodeURIComponent(resultId)}`,
      );
      cleanAuthResult();
      if (!response.ok || body?.status === "failed") {
        setStatus("signed-out");
        setMessage(body?.message || "Sign-in could not be completed. Please try again.");
        return;
      }
    }

    const session = await requestJson("/identity/v1/session");
    if (session.response.status === 401) {
      setStatus("signed-out");
      return;
    }
    if (!session.response.ok || !session.body?.authenticated) {
      setStatus("error");
      setMessage("Sign-in is temporarily unavailable. Please try again.");
      return;
    }

    const selected = await requestJson("/identity/v1/contexts/_select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: tenant.tenantId }),
    });
    if (selected.response.status === 401) {
      setStatus("signed-out");
      return;
    }
    if (selected.response.status === 403) {
      setStatus("forbidden");
      setMessage(`Your account does not have access to ${tenant.name}.`);
      return;
    }
    if (!selected.response.ok) {
      setStatus("error");
      setMessage("Your tenant session could not be prepared. Please try again.");
      return;
    }

    const { UserRequest: info, ...tokens } = selected.body || {};
    if (!info || info.type !== "EMPLOYEE" || info.tenantId !== tenant.tenantId) {
      setStatus("error");
      setMessage("The signed-in account did not produce a valid employee session for this tenant.");
      return;
    }
    info.roles = (info.roles || []).filter((role) => role.tenantId === tenant.tenantId);
    Digit.SessionStorage.set("Employee.tenantId", tenant.tenantId);
    const user = { info, ...tokens };
    Digit.SessionStorage.set("citizen.userRequestObject", user);
    Digit.UserService.setType("employee");
    Digit.UserService.setUser(user);
    setEmployeeDetail(info, tokens.access_token);
    window.location.replace(`${window.location.origin}${destination}`);
  };

  useEffect(() => {
    establishTenantSession().catch(() => {
      setStatus("error");
      setMessage("Sign-in is temporarily unavailable. Please try again.");
    });
    // Tenant context is immutable for the lifetime of this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const beginSignIn = () => {
    const returnUrl = new URL(window.location.pathname, window.location.origin);
    if (destination !== employeeBase) {
      returnUrl.searchParams.set("from", destination);
    }
    const returnTo = `${returnUrl.pathname}${returnUrl.search}`;
    window.location.assign(
      `/identity/v1/authorize?method=password&intent=signin&returnTo=${encodeURIComponent(returnTo)}`,
    );
  };

  if (status === "checking") return <Loader page={true} variant="PageLoader" />;

  return (
    <V2LoginShell>
      <V2Card
        style={{
          width: "100%",
          maxWidth: "420px",
          padding: "32px",
          display: "flex",
          flexDirection: "column",
          gap: "20px",
          borderRadius: "14px",
          border: "none",
          boxShadow: "0 12px 32px rgba(8, 20, 40, 0.18), 0 2px 8px rgba(8, 20, 40, 0.10)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center" }}>
          <Header />
        </div>
        <header style={{ textAlign: "center" }}>
          <h1 style={{ margin: 0, fontSize: "1.5rem", color: "var(--color-text-heading, #1D2433)" }}>
            {tr("CORE_COMMON_LOGIN", "Sign in")}
          </h1>
          <p style={{ margin: "8px 0 0", color: "var(--color-text-secondary, #505A5F)" }}>
            {tenant.name}
          </p>
        </header>
        {message ? (
          <div role="alert" style={{ color: "var(--color-error, #d4351c)", lineHeight: 1.45 }}>
            {message}
          </div>
        ) : null}
        {status === "forbidden" ? (
          <p style={{ margin: 0, color: "var(--color-text-secondary, #505A5F)" }}>
            Sign out if you need to use a different account.
          </p>
        ) : null}
        <V2Button
          type="button"
          width="full"
          onClick={
            status === "forbidden"
              ? Digit.UserService.logout
              : status === "error"
                ? establishTenantSession
                : beginSignIn
          }
        >
          {status === "forbidden" ? "Sign out" : status === "error" ? "Try again" : "Sign in →"}
        </V2Button>
      </V2Card>
    </V2LoginShell>
  );
};

export default IdentityBffEmployeeLogin;
