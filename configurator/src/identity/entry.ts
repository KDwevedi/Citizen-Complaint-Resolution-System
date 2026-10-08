import { API_ORIGIN, selectContext, type SessionUser, type TenantOption } from '@/api/onboarding';
import { apiClient } from '@/api/client';
import type { UserInfo } from '@/api/types';
import { installDigitContext } from '@/lib/session';
import { completedSteps, searchWorkspace } from './workspace';
import { resumePath } from '@/onboarding/progress';

const ALL_STEPS = [1, 2, 3, 4, 5];

/**
 * The workspace's setup progress, which decides whether the person lands in onboarding or the
 * console. Setup belongs to ACCOUNT_ADMIN; other staff always use the console. PGR answers for a
 * workspace that predates setup tracking with every step done.
 */
export async function workspaceProgress(tenantId: string, accountAdmin: boolean): Promise<number[]> {
  return accountAdmin ? completedSteps((await searchWorkspace(tenantId)).Workspace) : ALL_STEPS;
}

/** The one workspace to open without asking, when there is nothing to choose between. */
export function soleWorkspace(options: TenantOption[]): TenantOption | undefined {
  return options.length === 1 && !options[0].code ? options[0] : undefined;
}

/** Identity discovery has no readiness. PGR is consulted only after token selection. */
export async function enterWorkspace(tenantId: string, identity?: Pick<SessionUser, 'name' | 'email'> | null) {
  const context = await selectContext(tenantId);
  const previous = apiClient.getAuth();
  const previousEnvironment = apiClient.getEnvironment();
  apiClient.setEnvironment(API_ORIGIN || window.location.origin);
  apiClient.setAuth(context.access_token, context.UserRequest as UserInfo);
  // Workspace setup belongs to ACCOUNT_ADMIN. Other staff enter their existing workspace.
  const admin = context.UserRequest.roles.some(role => role.code === 'ACCOUNT_ADMIN' && role.tenantId === tenantId);
  try {
    const progress = await workspaceProgress(tenantId, admin);
    installDigitContext(context, identity, progress);
    window.location.assign(progress.length === 5 ? '/configurator/manage' : `/configurator${resumePath(progress)}`);
  } catch (error) {
    // A failed switch must not leave the old UI using the newly selected token.
    apiClient.setEnvironment(previousEnvironment);
    if (previous.token && previous.user) apiClient.setAuth(previous.token, previous.user);
    else apiClient.logout();
    throw error;
  }
}
