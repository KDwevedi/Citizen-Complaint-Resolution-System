package org.egov.pgr.repository;

import org.egov.pgr.util.PGRUtils;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Escalation-scheduler tenant discovery must stay inside the state root's own subtree. */
public class PGRRepositoryComplaintTenantIdsTest {

    @Test
    public void stateRootWithUnderscoreIsEscapedAndDelimited() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        PGRUtils utils = mock(PGRUtils.class);
        when(utils.replaceSchemaPlaceholder(anyString(), eq("ke_a")))
                .thenAnswer(inv -> inv.getArgument(0, String.class).replace("{schema}.", ""));
        when(jdbc.queryForList(anyString(), eq(String.class), eq("ke_a"), eq("ke\\_a.%")))
                .thenReturn(Collections.singletonList("ke_a.city"));

        PGRRepository repository = new PGRRepository(null, null, null, jdbc, utils, null);

        // Unescaped, 'ke_a.%' would also match 'kexa.city' — another root's complaints.
        assertEquals(Collections.singletonList("ke_a.city"), repository.getComplaintTenantIds("ke_a"));
        verify(jdbc).queryForList(
                eq("SELECT DISTINCT tenantid FROM eg_pgr_service_v2 WHERE (tenantid = ? OR tenantid LIKE ?) ORDER BY tenantid"),
                eq(String.class), eq("ke_a"), eq("ke\\_a.%"));
    }
}
