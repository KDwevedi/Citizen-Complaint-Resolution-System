package org.egov.pgr.util;

/**
 * The one LIKE-escape every pgr-services query uses. Search, dashboard and analytics all build
 * tenant and path predicates from it, so a change here reaches all of them at once.
 */
public final class SqlLike {

    private SqlLike() {
    }

    /**
     * Escapes LIKE metacharacters (with PostgreSQL's default backslash escape) so the value
     * matches literally before a wildcard is appended to it. Unescaped, {@code _} matches any
     * single character and {@code %} any run of them.
     */
    public static String escape(String value) {
        return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }
}
