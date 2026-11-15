package com.redpenstudio.apexoverdrive.meta;

/**
 * WHEN the Meta (Facebook) SDK may run, from the answer Google's consent message (UMP) stored on
 * the device for AdMob. Meta is used only for its automatic install and app-open events, to
 * measure Meta app install ads. It starts OFF on every device (manifest flags) and is switched on
 * only by {@link #decide}:
 *
 * - Nothing stored yet (UMP status UNKNOWN: first launch, offline, or the check never finished): OFF.
 * - GDPR applies (IABTCF_gdprApplies = 1: EEA, UK, Switzerland): ON only when the player consented
 *   to TCF purposes 1 (store/access information on a device) and 7 (measure ad performance), UMP
 *   says ads may be requested, AND Meta itself was consented: Meta is not an IAB TCF vendor; in
 *   Google's consent tools it is ad technology provider {@link #META_ATP_ID}, listed in the
 *   consented part of IABTCF_AddtlConsent.
 * - Elsewhere, UMP NOT_REQUIRED or OBTAINED: ON when UMP says ads may be requested, with Meta's
 *   Limited Data Use, UNLESS a US section of the GPP string is in force and does not record
 *   "did not opt out" ({@link UsPrivacyOptOut}, the owner's strict US rule).
 * - REQUIRED (consent form not completed): OFF.
 *
 * Same rules as the Zingora game (MetaConsentPolicy.kt), plus the strict US rule above.
 * Pure Java, unit tested (MetaConsentPolicyTest).
 */
public final class MetaConsentPolicy {

    /** Meta's id in Google's ad technology provider list. */
    public static final int META_ATP_ID = 89;
    /** TCF Purpose 1: store and/or access information on a device. */
    public static final int PURPOSE_STORE_ACCESS = 1;
    /** TCF Purpose 7: measure advertising performance. */
    public static final int PURPOSE_MEASURE_ADS = 7;

    private MetaConsentPolicy() {}

    /** UMP's stored consent status (ConsentInformation.ConsentStatus). */
    public enum UmpStatus { UNKNOWN, REQUIRED, NOT_REQUIRED, OBTAINED }

    /** What the device has stored about privacy choices (UMP status + the IAB keys UMP writes). */
    public static final class Signals {
        public final UmpStatus umpStatus;
        public final boolean canRequestAds;
        /** IABTCF_gdprApplies: TRUE (1), FALSE (0) or null (not stored). */
        public final Boolean gdprApplies;
        public final String purposeConsents;
        public final String addtlConsent;
        public final String gppSid;
        public final String gppString;

        public Signals(UmpStatus umpStatus, boolean canRequestAds, Boolean gdprApplies, String purposeConsents,
                       String addtlConsent, String gppSid, String gppString) {
            this.umpStatus = umpStatus == null ? UmpStatus.UNKNOWN : umpStatus;
            this.canRequestAds = canRequestAds;
            this.gdprApplies = gdprApplies;
            this.purposeConsents = purposeConsents;
            this.addtlConsent = addtlConsent;
            this.gppSid = gppSid;
            this.gppString = gppString;
        }
    }

    /** The decision and why (the reason is for logs only). */
    public static final class Decision {
        public final boolean enabled;
        public final String reason;

        Decision(boolean enabled, String reason) {
            this.enabled = enabled;
            this.reason = reason;
        }

        @Override
        public String toString() {
            return (enabled ? "ON (" : "OFF (") + reason + ")";
        }
    }

    public static Decision decide(Signals s) {
        if (s == null || s.umpStatus == UmpStatus.UNKNOWN) return off("consent not checked yet");
        if (Boolean.TRUE.equals(s.gdprApplies)) {
            if (!purposeConsented(s.purposeConsents, PURPOSE_STORE_ACCESS)) return off("gdpr: no consent for TCF purpose 1");
            if (!purposeConsented(s.purposeConsents, PURPOSE_MEASURE_ADS)) return off("gdpr: no consent for TCF purpose 7");
            if (!s.canRequestAds) return off("gdpr: ads may not be requested");
            if (!consentedAtp(s.addtlConsent, META_ATP_ID)) return off("gdpr: no consent for Meta (ad partner 89)");
            return on("gdpr: consent given");
        }
        switch (s.umpStatus) {
            case NOT_REQUIRED:
            case OBTAINED:
                if (!s.canRequestAds) return off("ads may not be requested");
                UsPrivacyOptOut.Result us = UsPrivacyOptOut.decide(s.gppSid, s.gppString);
                if (us != null) return new Decision(us.allowed, us.reason);
                return on("consent " + (s.umpStatus == UmpStatus.OBTAINED ? "obtained" : "not_required"));
            case REQUIRED:
            default:
                return off("consent required, not given");
        }
    }

    /** '1' at position {@code purpose} (1-based) of IABTCF_PurposeConsents. */
    public static boolean purposeConsented(String bits, int purpose) {
        return bits != null && bits.length() >= purpose && bits.charAt(purpose - 1) == '1';
    }

    /**
     * Whether {@code id} is in the consented part of an Additional Consent string. Version 1 is
     * "1~id.id.id"; version 2 is "2~consented.ids~dv.disclosed.ids" (only the consented part counts).
     */
    public static boolean consentedAtp(String ac, int id) {
        if (ac == null) return false;
        String[] parts = ac.trim().split("~", -1);
        if (parts.length < 2 || !(parts[0].equals("1") || parts[0].equals("2"))) return false;
        if (parts[1].startsWith("dv.")) return false; // no consented part, only disclosed ids
        String wanted = String.valueOf(id);
        for (String p : parts[1].split("\\.", -1)) {
            if (p.equals(wanted)) return true;
        }
        return false;
    }

    private static Decision on(String reason) {
        return new Decision(true, reason);
    }

    private static Decision off(String reason) {
        return new Decision(false, reason);
    }
}
