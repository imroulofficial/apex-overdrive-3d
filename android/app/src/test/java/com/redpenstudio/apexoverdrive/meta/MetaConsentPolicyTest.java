package com.redpenstudio.apexoverdrive.meta;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import com.redpenstudio.apexoverdrive.meta.MetaConsentPolicy.Signals;
import com.redpenstudio.apexoverdrive.meta.MetaConsentPolicy.UmpStatus;
import org.junit.Test;

/** When Meta install / app-open measurement may run (same rules as Zingora's MetaConsentPolicyTest). */
public class MetaConsentPolicyTest {

    private static final String ALL_PURPOSES = "11111111111";
    // Strings Google's AdMob team published for the UMP US states message (usnat, section 7).
    static final String US_ALLOW = "DBABL~BVQqAAAAAg";
    static final String US_OPTED_OUT = "DBABL~BVQVAAAAAg";
    static final String US_NO_CHOICE = "DBABL~BAAAAAAAAg";

    private static Signals gdpr(String purposes, String ac, UmpStatus status, boolean canRequestAds) {
        return new Signals(status, canRequestAds, true, purposes, ac, null, null);
    }

    private static Signals gdpr(String purposes, String ac) {
        return gdpr(purposes, ac, UmpStatus.OBTAINED, true);
    }

    private static Signals elsewhere(UmpStatus status, boolean canRequestAds, Boolean gdprApplies, String gppSid, String gppString) {
        return new Signals(status, canRequestAds, gdprApplies, null, null, gppSid, gppString);
    }

    private static Signals elsewhere(UmpStatus status) {
        return elsewhere(status, true, false, null, null);
    }

    private static boolean on(Signals s) {
        return MetaConsentPolicy.decide(s).enabled;
    }

    @Test
    public void metaIsAdPartner89AndNeedsPurposes1And7() {
        assertEquals(89, MetaConsentPolicy.META_ATP_ID);
        assertEquals(1, MetaConsentPolicy.PURPOSE_STORE_ACCESS);
        assertEquals(7, MetaConsentPolicy.PURPOSE_MEASURE_ADS);
    }

    @Test
    public void nothingRunsBeforeTheFirstAnswer() {
        assertFalse(on(elsewhere(UmpStatus.UNKNOWN, false, null, null, null)));
        // Even a stale TCF string or US "allow" does not count while UMP has no status.
        assertFalse(on(gdpr(ALL_PURPOSES, "2~89.1097~dv.33", UmpStatus.UNKNOWN, true)));
        assertFalse(on(elsewhere(UmpStatus.UNKNOWN, true, false, "7", US_ALLOW)));
        assertFalse(on(null));
        // A null status counts as UNKNOWN.
        assertFalse(on(new Signals(null, true, false, null, null, null, null)));
    }

    @Test
    public void gdprConsentToEverythingTurnsMetaOn() {
        assertTrue(on(gdpr(ALL_PURPOSES, "2~89.2253~dv.70")));
        assertTrue(on(gdpr(ALL_PURPOSES, "1~43.89.1097")));
    }

    @Test
    public void gdprRefusedOrClosedKeepsMetaOff() {
        // "Do not consent": no purposes.
        assertFalse(on(gdpr("00000000000", "2~~dv.89")));
        // Form closed without an answer: nothing stored, status still REQUIRED.
        assertFalse(on(gdpr(null, null, UmpStatus.REQUIRED, false)));
        // Store/access refused, or ad measurement refused.
        assertFalse(on(gdpr("01111111111", "2~89~dv.")));
        assertFalse(on(gdpr("11111101111", "2~89~dv.")));
        // Purposes and Meta given, but UMP says ads may not be requested.
        assertFalse(on(gdpr(ALL_PURPOSES, "2~89~dv.", UmpStatus.OBTAINED, false)));
        // A stale UMP status never overrides the stored GDPR signal.
        assertFalse(on(gdpr("0", "2~~dv.89", UmpStatus.NOT_REQUIRED, true)));
    }

    @Test
    public void gdprConsentWithoutMetaKeepsMetaOff() {
        assertFalse(on(gdpr(ALL_PURPOSES, "2~2253~dv.89"))); // Meta only disclosed
        assertFalse(on(gdpr(ALL_PURPOSES, null)));
        assertFalse(on(gdpr(ALL_PURPOSES, "2~43.890~dv.89"))); // 890 is not 89
        assertFalse(on(gdpr(ALL_PURPOSES, "2~dv.89"))); // no consented part
        // The EU rules win where GDPR applies, whatever a stale GPP string says.
        assertFalse(on(new Signals(UmpStatus.OBTAINED, true, true, ALL_PURPOSES, "2~~dv.89", "7", US_ALLOW)));
    }

    @Test
    public void noConsentRequiredTurnsMetaOnAfterTheCheck() {
        // Bangladesh and every other non-GDPR, non-US-message region.
        for (Boolean gdprApplies : new Boolean[] { false, null }) {
            for (String sid : new String[] { null, "", "-1", "0", "2" }) {
                assertTrue(gdprApplies + " " + sid, on(elsewhere(UmpStatus.NOT_REQUIRED, true, gdprApplies, sid, null)));
            }
        }
        // OBTAINED outside GDPR with no US section in force: on, as in Zingora.
        assertTrue(on(elsewhere(UmpStatus.OBTAINED)));
        assertTrue(on(elsewhere(UmpStatus.OBTAINED, true, null, "-1", null)));
    }

    @Test
    public void aRequiredOrRefusedAnswerOutsideGdprKeepsMetaOff() {
        assertFalse(on(elsewhere(UmpStatus.REQUIRED, false, false, null, null)));
        assertFalse(on(elsewhere(UmpStatus.REQUIRED, true, null, null, null)));
        assertFalse(on(elsewhere(UmpStatus.NOT_REQUIRED, false, false, null, null)));
        assertFalse(on(elsewhere(UmpStatus.OBTAINED, false, false, null, null)));
    }

    @Test
    public void usStatesMessageStrictWhereAUsSectionIsInForce() {
        for (UmpStatus status : new UmpStatus[] { UmpStatus.NOT_REQUIRED, UmpStatus.OBTAINED }) {
            assertTrue(on(elsewhere(status, true, false, "7", US_ALLOW)));
            assertFalse(on(elsewhere(status, true, false, "7", US_OPTED_OUT)));
            // No choice recorded, missing or broken string: off (owner's strict rule).
            assertFalse(on(elsewhere(status, true, false, "7", US_NO_CHOICE)));
            assertFalse(on(elsewhere(status, true, false, "7", null)));
            assertFalse(on(elsewhere(status, true, false, "7", "DBABL")));
            assertFalse(on(elsewhere(status, true, false, "7", "garbage")));
            // GPC, or a US section this code cannot read.
            assertFalse(on(elsewhere(status, true, false, "7", "DBABL~BVQqAAAAAg.YA")));
            assertFalse(on(elsewhere(status, true, false, "8", US_ALLOW)));
            assertFalse(on(elsewhere(status, true, false, "7_8", US_ALLOW)));
            assertFalse(on(elsewhere(status, true, false, "6", US_ALLOW)));
            // A stale US string with no US section in force does not count.
            assertTrue(on(elsewhere(status, true, false, "-1", US_OPTED_OUT)));
        }
    }

    @Test
    public void additionalConsentAndPurposeParsing() {
        assertTrue(MetaConsentPolicy.consentedAtp("2~89.2253~dv.70.540", 89));
        assertTrue(MetaConsentPolicy.consentedAtp("1~1.89", 89));
        assertFalse(MetaConsentPolicy.consentedAtp("2~~dv.89.2253", 89));
        assertFalse(MetaConsentPolicy.consentedAtp("3~89", 89));
        assertFalse(MetaConsentPolicy.consentedAtp("", 89));
        assertFalse(MetaConsentPolicy.consentedAtp("garbage", 89));
        assertFalse(MetaConsentPolicy.consentedAtp(null, 89));
        assertTrue(MetaConsentPolicy.purposeConsented("1000001", 1));
        assertTrue(MetaConsentPolicy.purposeConsented("1000001", 7));
        assertFalse(MetaConsentPolicy.purposeConsented("1000000", 7));
        assertFalse(MetaConsentPolicy.purposeConsented("1", 7));
        assertFalse(MetaConsentPolicy.purposeConsented(null, 1));
    }
}
