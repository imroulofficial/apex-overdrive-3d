package com.redpenstudio.apexoverdrive.meta;

import java.util.ArrayList;
import java.util.List;

/**
 * US state privacy opt-out for Meta measurement, read from the IAB Global Privacy Platform (GPP)
 * values that Google's US states message (UMP) stores on the device. UMP writes only
 * IABGPP_GppSID and IABGPP_HDR_GppString, so the string is decoded here (just the fields needed).
 *
 * Applies only where a US section is actually in force (a US id in IABGPP_GppSID). There Meta may
 * run only when the US National (usnat, section 7) core says the player did NOT opt out of the
 * sale of personal information, of its sharing, and of targeted advertising (value 2 for all
 * three), and Global Privacy Control is off. An opt-out (1), no recorded choice (0, the owner's
 * strict rule of 2026-11-14), a section this code cannot read (another US section, a newer usnat
 * version) or a missing / broken string keeps Meta off.
 *
 * Pure Java, unit tested (UsPrivacyOptOutTest).
 */
public final class UsPrivacyOptOut {

    public static final int USNAT_SECTION = 7;
    private static final String B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

    private UsPrivacyOptOut() {}

    /** The US answer: allowed or not, and why. */
    public static final class Result {
        public final boolean allowed;
        public final String reason;

        Result(boolean allowed, String reason) {
            this.allowed = allowed;
            this.reason = reason;
        }
    }

    /** Decoded usnat core fields (0 not applicable / no notice, 1 opted out, 2 did not opt out). */
    public static final class Usnat {
        public final int version;
        public final int saleOptOut;
        public final int sharingOptOut;
        public final int targetedAdvertisingOptOut;
        public final boolean gpc;

        Usnat(int version, int sale, int sharing, int targeted, boolean gpc) {
            this.version = version;
            this.saleOptOut = sale;
            this.sharingOptOut = sharing;
            this.targetedAdvertisingOptOut = targeted;
            this.gpc = gpc;
        }
    }

    /** null when no US section is in force; otherwise the US opt-out answer. */
    public static Result decide(String gppSid, String gppString) {
        List<Integer> us = new ArrayList<>();
        for (int id : sectionsInForce(gppSid)) if (isUsSection(id)) us.add(id);
        if (us.isEmpty()) return null;
        for (int id : us) {
            if (id != USNAT_SECTION) return new Result(false, "us: unreadable GPP section " + join(us));
        }
        if (gppString == null) return new Result(false, "us: no GPP string");
        String[] parts = gppString.split("~", -1);
        List<Integer> header = decodeHeaderSectionIds(parts[0]);
        int index = header == null ? -1 : header.indexOf(USNAT_SECTION);
        Usnat usnat = index >= 0 && index + 1 < parts.length ? decodeUsnat(parts[index + 1]) : null;
        if (usnat == null) return new Result(false, "us: unreadable GPP string");
        if (usnat.gpc) return new Result(false, "us: Global Privacy Control");
        int sale = usnat.saleOptOut, sharing = usnat.sharingOptOut, targeted = usnat.targetedAdvertisingOptOut;
        if (sale == 1 || sharing == 1 || targeted == 1) return new Result(false, "us: opted out");
        if (sale == 2 && sharing == 2 && targeted == 2) return new Result(true, "us: did not opt out");
        return new Result(false, "us: no choice recorded");
    }

    /** US privacy sections: 6 (old US Privacy string), 7 (usnat) and every state section after it. */
    static boolean isUsSection(int id) {
        return id == 6 || id >= USNAT_SECTION;
    }

    /** GPP section ids in force from IABGPP_GppSID ("7", "2_7"; "-1" or "" = none). */
    public static List<Integer> sectionsInForce(String gppSid) {
        List<Integer> ids = new ArrayList<>();
        if (gppSid == null) return ids;
        for (String part : gppSid.split("_", -1)) {
            try {
                int id = Integer.parseInt(part.trim());
                if (id > 0) ids.add(id);
            } catch (NumberFormatException ignored) {
                // not a section id
            }
        }
        return ids;
    }

    /** Section ids listed in a GPP header (the first "~" part), or null if unreadable. */
    public static List<Integer> decodeHeaderSectionIds(String header) {
        String bits = toBits(header);
        if (bits == null) return null;
        try {
            Bits r = new Bits(bits);
            int type = r.integer(6);
            r.integer(6); // version
            if (type != 3) return null;
            int count = r.integer(12);
            List<Integer> ids = new ArrayList<>();
            int last = 0;
            for (int i = 0; i < count; i++) {
                boolean group = r.integer(1) == 1;
                int start = last + r.fibonacci();
                if (group) {
                    int end = start + r.fibonacci();
                    for (int id = start; id <= end; id++) ids.add(id);
                    last = end;
                } else {
                    ids.add(start);
                    last = start;
                }
            }
            return ids;
        } catch (IllegalStateException e) {
            return null;
        }
    }

    /** US National section v1/v2 core plus its GPC subsection, or null if unreadable. */
    public static Usnat decodeUsnat(String section) {
        if (section == null || section.isEmpty()) return null;
        String[] parts = section.split("\\.", -1);
        String bits = toBits(parts[0]);
        if (bits == null) return null;
        try {
            Bits r = new Bits(bits);
            int version = r.integer(6);
            if (version != 1 && version != 2) return null; // a layout this code does not know
            for (int i = 0; i < 6; i++) r.integer(2); // the six notice fields
            int sale = r.integer(2);
            int sharing = r.integer(2);
            int targeted = r.integer(2);
            boolean gpc = false;
            for (int i = 1; i < parts.length; i++) {
                String sb = toBits(parts[i]);
                if (sb == null) return null;
                Bits sr = new Bits(sb);
                if (sr.integer(2) == 1 && sr.integer(1) == 1) gpc = true;
            }
            return new Usnat(version, sale, sharing, targeted, gpc);
        } catch (IllegalStateException e) {
            return null;
        }
    }

    /** base64url text to a '0'/'1' string (6 bits per character); null if empty or invalid. */
    static String toBits(String text) {
        if (text == null || text.isEmpty()) return null;
        StringBuilder bits = new StringBuilder(text.length() * 6);
        for (int i = 0; i < text.length(); i++) {
            int v = B64URL.indexOf(text.charAt(i));
            if (v < 0) return null;
            for (int b = 5; b >= 0; b--) bits.append((v >> b & 1) == 1 ? '1' : '0');
        }
        return bits.toString();
    }

    private static String join(List<Integer> ids) {
        StringBuilder s = new StringBuilder();
        for (int i = 0; i < ids.size(); i++) s.append(i == 0 ? "" : ", ").append(ids.get(i));
        return s.toString();
    }

    private static final class Bits {
        private final String bits;
        private int pos = 0;

        Bits(String bits) {
            this.bits = bits;
        }

        int integer(int n) {
            if (pos + n > bits.length()) throw new IllegalStateException("gpp: out of bits");
            int v = Integer.parseInt(bits.substring(pos, pos + n), 2);
            pos += n;
            return v;
        }

        // Fibonacci-coded integer: bits weighted 1, 2, 3, 5, 8..., terminated by "11".
        int fibonacci() {
            List<Integer> fibs = new ArrayList<>();
            fibs.add(1);
            fibs.add(2);
            int value = 0;
            char prev = '0';
            for (int i = 0; ; i++) {
                if (pos >= bits.length()) throw new IllegalStateException("gpp: out of bits");
                char b = bits.charAt(pos++);
                if (b == '1' && prev == '1') return value;
                if (i >= fibs.size()) fibs.add(fibs.get(i - 1) + fibs.get(i - 2));
                if (b == '1') value += fibs.get(i);
                prev = b;
            }
        }
    }
}
