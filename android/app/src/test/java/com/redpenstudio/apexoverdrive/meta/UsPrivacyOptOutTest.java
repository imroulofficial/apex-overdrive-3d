package com.redpenstudio.apexoverdrive.meta;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import org.junit.Test;

/** GPP decoding for the US states opt-out (ported from the v67 JavaScript tests). */
public class UsPrivacyOptOutTest {

    @Test
    public void gppHeaderSectionIdsIncludingTheSpecExamples() {
        assertEquals(Collections.singletonList(2), UsPrivacyOptOut.decodeHeaderSectionIds("DBABM"));
        assertEquals(Arrays.asList(2, 6), UsPrivacyOptOut.decodeHeaderSectionIds("DBACNY"));
        assertEquals(Arrays.asList(5, 6), UsPrivacyOptOut.decodeHeaderSectionIds("DBABjw"));
        assertEquals(Collections.singletonList(7), UsPrivacyOptOut.decodeHeaderSectionIds("DBABL"));
        for (String bad : new String[] { "", null, "D", "AAAA", "!!!" }) assertNull(bad, UsPrivacyOptOut.decodeHeaderSectionIds(bad));
    }

    @Test
    public void usnatCoreOptOutsAndGpc() {
        assertUsnat(UsPrivacyOptOut.decodeUsnat("BVQqAAAAAg"), 2, 2, 2, false);
        assertUsnat(UsPrivacyOptOut.decodeUsnat("BVQVAAAAAg"), 1, 1, 1, false);
        assertUsnat(UsPrivacyOptOut.decodeUsnat("BAAAAAAAAg"), 0, 0, 0, false);
        assertUsnat(UsPrivacyOptOut.decodeUsnat("BVQmAAAAAg"), 2, 1, 2, false);
        assertTrue(UsPrivacyOptOut.decodeUsnat("BVQqAAAAAg.YA").gpc);
        assertFalse(UsPrivacyOptOut.decodeUsnat("BVQqAAAAAg.QA").gpc);
        assertNull(UsPrivacyOptOut.decodeUsnat("DVQqAAAAAg")); // usnat version 3: layout not known here
        for (String bad : new String[] { "", null, "B", "BV?q" }) assertNull(bad, UsPrivacyOptOut.decodeUsnat(bad));
    }

    @Test
    public void sectionsInForce() {
        assertEquals(Collections.singletonList(7), UsPrivacyOptOut.sectionsInForce("7"));
        assertEquals(Arrays.asList(2, 7), UsPrivacyOptOut.sectionsInForce("2_7"));
        for (String none : new String[] { "-1", "0", "", null }) assertTrue(String.valueOf(none), UsPrivacyOptOut.sectionsInForce(none).isEmpty());
    }

    @Test
    public void onlyAppliesWhereAUsSectionIsInForce() {
        assertNull(UsPrivacyOptOut.decide("-1", MetaConsentPolicyTest.US_OPTED_OUT));
        assertNull(UsPrivacyOptOut.decide(null, null));
        assertNull(UsPrivacyOptOut.decide("2", "DBABM~whatever"));
        assertTrue(UsPrivacyOptOut.decide("7", MetaConsentPolicyTest.US_ALLOW).allowed);
        assertFalse(UsPrivacyOptOut.decide("7", MetaConsentPolicyTest.US_OPTED_OUT).allowed);
        assertFalse(UsPrivacyOptOut.decide("7", "DBABL~BVQmAAAAAg").allowed); // one opt-out is enough
        assertFalse(UsPrivacyOptOut.decide("7", MetaConsentPolicyTest.US_NO_CHOICE).allowed);
        assertFalse(UsPrivacyOptOut.decide("7", "DBABM~BVQqAAAAAg").allowed); // header says the part is TCF
    }

    private static void assertUsnat(UsPrivacyOptOut.Usnat u, int sale, int sharing, int targeted, boolean gpc) {
        assertEquals(1, u.version);
        assertEquals(sale, u.saleOptOut);
        assertEquals(sharing, u.sharingOptOut);
        assertEquals(targeted, u.targetedAdvertisingOptOut);
        assertEquals(gpc, u.gpc);
    }
}
