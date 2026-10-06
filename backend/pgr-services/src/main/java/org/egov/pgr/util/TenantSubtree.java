package org.egov.pgr.util;

import java.util.List;

/**
 * The tenant predicate every pgr-services query uses: a state-level tenant covers its subtree,
 * any other tenant matches exactly.
 *
 * <p>The subtree is the tenant ITSELF plus everything under a '.' beneath it. A bare
 * {@code LIKE value || '%'} also matches a sibling whose id merely starts with the same
 * characters, so with {@code state.level.tenantid.length=1} root {@code ke} would read every row
 * of the unrelated root {@code kenya}. The delimiter is therefore part of the pattern, and the
 * tenant id is LIKE-escaped, or an id containing {@code _} would match any character there. This
 * agrees with {@code PolicyDrivenScopeResolver.isAuthorizedTenant}
 * ({@code equals || startsWith(caller + ".")}).
 *
 * <p>Build tenant predicates here rather than by hand, so the delimiter and the escape cannot be
 * forgotten at a new call site.
 */
public final class TenantSubtree {

    private TenantSubtree() {
    }

    /**
     * Returns the predicate for {@code column} and appends its bind values to {@code params}.
     * The caller adds any surrounding {@code WHERE}/{@code AND}.
     *
     * @param stateLevel true for the tenant plus its subtree, false for an exact match
     */
    public static String predicate(String column, String tenantId, boolean stateLevel, List<Object> params) {
        if (!stateLevel) {
            params.add(tenantId);
            return column + " = ?";
        }
        params.add(tenantId);
        params.add(subtreePattern(tenantId));
        return "(" + column + " = ? OR " + column + " LIKE ?)";
    }

    /** The LIKE pattern for everything strictly beneath {@code tenantId}: {@code 'ke' -> 'ke.%'}. */
    public static String subtreePattern(String tenantId) {
        return SqlLike.escape(tenantId) + ".%";
    }
}
