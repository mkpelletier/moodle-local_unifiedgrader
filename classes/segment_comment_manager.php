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
 * CRUD operations for segment-anchored feedback comments (Phase 2).
 *
 * @package    local_unifiedgrader
 * @copyright  2026 South African Theological Seminary (mathieu@sats.ac.za)
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

namespace local_unifiedgrader;

/**
 * Manages segment-anchored comments stored per student per attempt.
 *
 * A segment comment is a grader remark attached to a phrase/clause of the
 * student's original submission text. The anchor (startoffset/endoffset/
 * anchortext) is computed server-side against local_nida's aligned source, so
 * it survives re-translation. This class is pure DB access — all capability
 * checks and anchor resolution happen in the calling externals.
 */
class segment_comment_manager {
    /** @var string The database table name (frozen by WP-P1). */
    private const TABLE = 'local_unifiedgrader_segcomment';

    /** @var string[] The mark types a segment mark may carry. */
    public const MARK_TYPES = ['comment', 'tick', 'cross', 'highlight', 'query', 'strikethrough'];

    /**
     * Coerce an arbitrary string to a valid mark type, defaulting to 'comment'.
     *
     * @param string $marktype The requested mark type.
     * @return string A valid mark type.
     */
    public static function normalise_marktype(string $marktype): string {
        return in_array($marktype, self::MARK_TYPES, true) ? $marktype : 'comment';
    }

    /**
     * Insert a new segment comment.
     *
     * @param int $cmid Course module ID.
     * @param int $userid Student user ID (the comment is about this user).
     * @param int $authorid Grader user ID.
     * @param int $submissionid Assignment submission ID (0 if none resolved).
     * @param int $attemptnumber Attempt number the comment belongs to.
     * @param string $sourcetype 'onlinetext' or 'file'.
     * @param int $fileid {files}.id for file sources, 0 for online text.
     * @param int $segmentid The nida FIELD segment id (for scoping).
     * @param int $startoffset Char offset of the anchor start in the source plaintext.
     * @param int $endoffset Char offset of the anchor end in the source plaintext.
     * @param string $anchortext The exact source phrase (plaintext).
     * @param string $commenttext The grader's comment (cleaned HTML).
     * @param int $commentformat The comment text format (FORMAT_HTML).
     * @param string $marktype The mark type: comment, tick, cross, highlight or query.
     * @param int $page 1-based PDF page for file (PDF text-layer) marks; 0 for online text.
     * @return \stdClass The stored record (with its new id).
     */
    public static function create(
        int $cmid,
        int $userid,
        int $authorid,
        int $submissionid,
        int $attemptnumber,
        string $sourcetype,
        int $fileid,
        int $segmentid,
        int $startoffset,
        int $endoffset,
        string $anchortext,
        string $commenttext,
        int $commentformat,
        string $marktype = 'comment',
        int $page = 0
    ): \stdClass {
        global $DB;

        $now = time();
        $record = (object) [
            'cmid' => $cmid,
            'userid' => $userid,
            'authorid' => $authorid,
            'submissionid' => $submissionid,
            'attemptnumber' => $attemptnumber,
            'sourcetype' => $sourcetype,
            'fileid' => $fileid,
            'page' => max(0, $page),
            'segmentid' => $segmentid,
            'startoffset' => $startoffset,
            'endoffset' => $endoffset,
            'anchortext' => $anchortext,
            'commenttext' => $commenttext,
            'commentformat' => $commentformat,
            'marktype' => self::normalise_marktype($marktype),
            'timecreated' => $now,
            'timemodified' => $now,
        ];
        $record->id = $DB->insert_record(self::TABLE, $record);

        return $record;
    }

    /**
     * Get all segment comments for a student/attempt, joined with author names.
     *
     * A single query returns every comment for the (cmid, userid) pair, optionally
     * scoped to one attempt. Author name fields are joined so the caller can build
     * a display name with fullname() without an N+1 lookup.
     *
     * @param int $cmid Course module ID.
     * @param int $userid Student user ID.
     * @param int $attempt Attempt number, or -1 for all attempts.
     * @return array Ordered list of comment records (with joined user name fields).
     */
    public static function get_for(int $cmid, int $userid, int $attempt = -1): array {
        global $DB;

        $where = 'sc.cmid = :cmid AND sc.userid = :userid';
        $conditions = ['cmid' => $cmid, 'userid' => $userid];
        if ($attempt >= 0) {
            $where .= ' AND sc.attemptnumber = :attempt';
            $conditions['attempt'] = $attempt;
        }

        $sql = "SELECT sc.*, u.firstname, u.lastname, u.firstnamephonetic,
                       u.lastnamephonetic, u.middlename, u.alternatename
                  FROM {" . self::TABLE . "} sc
                  JOIN {user} u ON u.id = sc.authorid
                 WHERE {$where}
              ORDER BY sc.startoffset ASC, sc.timecreated ASC";

        return array_values($DB->get_records_sql($sql, $conditions));
    }

    /**
     * Get a single segment comment by id.
     *
     * @param int $id Comment id.
     * @return \stdClass|null The record, or null when it does not exist.
     */
    public static function get(int $id): ?\stdClass {
        global $DB;
        $record = $DB->get_record(self::TABLE, ['id' => $id]);
        return $record ?: null;
    }

    /**
     * Count segment comments for a student/attempt.
     *
     * @param int $cmid Course module ID.
     * @param int $userid Student user ID.
     * @param int $attempt Attempt number, or -1 for all attempts.
     * @return int The number of comments.
     */
    public static function count_for(int $cmid, int $userid, int $attempt = -1): int {
        global $DB;
        $conditions = ['cmid' => $cmid, 'userid' => $userid];
        if ($attempt >= 0) {
            $conditions['attemptnumber'] = $attempt;
        }
        return $DB->count_records(self::TABLE, $conditions);
    }

    /**
     * Delete a segment comment, scoped to its author.
     *
     * The authorid predicate is a defence-in-depth guard: even if a caller
     * skipped the ownership check, a grader can only ever delete their own row.
     *
     * @param int $id Comment id.
     * @param int $authorid The requesting grader's user id.
     */
    public static function delete(int $id, int $authorid): void {
        global $DB;
        $DB->delete_records(self::TABLE, ['id' => $id, 'authorid' => $authorid]);
    }
}
