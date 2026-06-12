<?php
// This file is part of Moodle - http://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Moodle is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Moodle.  If not, see <http://www.gnu.org/licenses/>.

/**
 * CRUD operations for academic-integrity referrals.
 *
 * @package    local_unifiedgrader
 * @copyright  2026 South African Theological Seminary (mathieu@sats.ac.za)
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

namespace local_unifiedgrader;

/**
 * Manages academic-integrity referrals per student per activity.
 *
 * A referral flags a graded submission for an integrity / plagiarism review.
 * Other plugins consume the open flag to pause a grading-turnaround metric.
 * At most one OPEN referral may exist for a given (cmid, userid) pair.
 */
class referral_manager {
    /** @var string Table name. */
    private const TABLE = 'local_unifiedgrader_referral';

    /**
     * Refer a student's submission for an integrity review.
     *
     * Idempotent: if an open referral already exists for (cmid, userid),
     * its id is returned and no duplicate is created.
     *
     * @param int $cmid Course module ID.
     * @param int $userid Student user ID.
     * @param int $authorid Author (teacher) user ID.
     * @param string $reason Referral reason (max 30 chars).
     * @param string $note Optional free-text note.
     * @return int The referral ID.
     */
    public static function refer(
        int $cmid,
        int $userid,
        int $authorid,
        string $reason = 'integrity',
        string $note = '',
    ): int {
        global $DB;

        // Idempotent: reuse an existing open referral for this pair.
        $existing = $DB->get_record(self::TABLE, [
            'cmid' => $cmid,
            'userid' => $userid,
            'status' => 'open',
        ]);
        if ($existing) {
            return (int) $existing->id;
        }

        $now = time();
        $record = (object) [
            'cmid' => $cmid,
            'userid' => $userid,
            'authorid' => $authorid,
            'reason' => \core_text::substr(trim($reason), 0, 30),
            'note' => $note !== '' ? $note : null,
            'status' => 'open',
            'outcome' => null,
            'timereferred' => $now,
            'timeresolved' => 0,
            'timemodified' => $now,
        ];

        return $DB->insert_record(self::TABLE, $record);
    }

    /**
     * Resolve an open referral with an outcome.
     *
     * @param int $id The referral ID.
     * @param string $outcome The resolution outcome (e.g. 'cleared' or 'upheld').
     * @return bool True on success.
     */
    public static function resolve(int $id, string $outcome): bool {
        global $DB;

        $now = time();
        $record = (object) [
            'id' => $id,
            'status' => 'resolved',
            'outcome' => \core_text::substr(trim($outcome), 0, 15),
            'timeresolved' => $now,
            'timemodified' => $now,
        ];

        return $DB->update_record(self::TABLE, $record);
    }

    /**
     * Get the open referral for a student in an activity, if any.
     *
     * @param int $cmid Course module ID.
     * @param int $userid Student user ID.
     * @return array|null The open referral as an assoc array, or null.
     */
    public static function get_open(int $cmid, int $userid): ?array {
        global $DB;

        $record = $DB->get_record(self::TABLE, [
            'cmid' => $cmid,
            'userid' => $userid,
            'status' => 'open',
        ]);

        return $record ? self::format($record) : null;
    }

    /**
     * Get all referrals for a student in an activity, newest first.
     *
     * @param int $cmid Course module ID.
     * @param int $userid Student user ID.
     * @return array List of referral arrays.
     */
    public static function get_for_activity(int $cmid, int $userid): array {
        global $DB;

        $records = $DB->get_records(self::TABLE, [
            'cmid' => $cmid,
            'userid' => $userid,
        ], 'timereferred DESC, id DESC');

        return array_values(array_map([self::class, 'format'], $records));
    }

    /**
     * Normalise a referral record into an assoc array with cast types.
     *
     * @param \stdClass $rec The DB record.
     * @return array
     */
    private static function format(\stdClass $rec): array {
        return [
            'id' => (int) $rec->id,
            'cmid' => (int) $rec->cmid,
            'userid' => (int) $rec->userid,
            'authorid' => (int) $rec->authorid,
            'reason' => $rec->reason,
            'note' => $rec->note ?? '',
            'status' => $rec->status,
            'outcome' => $rec->outcome ?? '',
            'timereferred' => (int) $rec->timereferred,
            'timeresolved' => (int) $rec->timeresolved,
            'timemodified' => (int) $rec->timemodified,
        ];
    }
}
