package org.egov.pgr.util;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

public class SqlLikeTest {

    @Test
    public void escapesEveryLikeMetacharacter() {
        assertEquals("ke\\_a", SqlLike.escape("ke_a"));
        assertEquals("ke\\%", SqlLike.escape("ke%"));
        // The backslash goes first, or the escapes it adds would be escaped again.
        assertEquals("ke\\\\root", SqlLike.escape("ke\\root"));
        assertEquals("ke\\%\\_\\\\root", SqlLike.escape("ke%_\\root"));
        assertEquals("ke.bomet", SqlLike.escape("ke.bomet"));
    }
}
