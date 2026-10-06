package org.egov.pgr.util;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

public class TenantSubtreeTest {

    @Test
    public void stateLevelCoversTheTenantAndItsDelimitedSubtree() {
        List<Object> params = new ArrayList<>();
        assertEquals("(t.tenantid = ? OR t.tenantid LIKE ?)",
                TenantSubtree.predicate("t.tenantid", "ke", true, params));
        // 'ke.%' — never 'ke%', which would also match the sibling root 'kenya'.
        assertEquals(Arrays.asList("ke", "ke.%"), params);
    }

    @Test
    public void stateLevelEscapesLikeMetacharacters() {
        List<Object> params = new ArrayList<>();
        TenantSubtree.predicate("tenant_id", "ke_a", true, params);
        // Unescaped, '_' would let 'ke_a' match 'kexa.city'.
        assertEquals(Arrays.asList("ke_a", "ke\\_a.%"), params);
    }

    @Test
    public void otherTenantsMatchExactly() {
        List<Object> params = new ArrayList<>();
        assertEquals("tenant_id = ?", TenantSubtree.predicate("tenant_id", "ke.bomet", false, params));
        assertEquals(Arrays.asList("ke.bomet"), params);
    }

    @Test
    public void appendsToExistingParams() {
        List<Object> params = new ArrayList<>(Arrays.asList("x"));
        TenantSubtree.predicate("c", "pg", true, params);
        assertEquals(Arrays.asList("x", "pg", "pg.%"), params);
    }
}
