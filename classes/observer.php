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
 * Event observer callbacks for local_unifiedgrader.
 *
 * These observers keep the plugin in sync when grades or submissions change
 * through native activity UIs. In Phase 1 they are stubs for future
 * cache invalidation and real-time update logic.
 *
 * @package    local_unifiedgrader
 * @copyright  2026 South African Theological Seminary (mathieu@sats.ac.za)
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

namespace local_unifiedgrader;

/**
 * Event observer callbacks for keeping the plugin in sync with native activity UIs.
 *
 * @package    local_unifiedgrader
 * @copyright  2026 South African Theological Seminary (mathieu@sats.ac.za)
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class observer {
    /**
     * Handle assignment submission graded event.
     *
     * @param \mod_assign\event\submission_graded $event
     */
    public static function handle_submission_graded(\mod_assign\event\submission_graded $event): void {
        // Future: invalidate cached participant/grade data for this activity.
    }

    /**
     * Handle core user graded event.
     *
     * @param \core\event\user_graded $event
     */
    public static function handle_user_graded(\core\event\user_graded $event): void {
        // Future: invalidate cached data when a grade changes via gradebook.
    }

    /**
     * Handle assignment submission created event.
     *
     * @param \mod_assign\event\submission_created $event
     */
    public static function handle_submission_created(\mod_assign\event\submission_created $event): void {
        // Future: invalidate cached participant data for this activity.
    }

    /**
     * Handle assignment submission updated event.
     *
     * @param \mod_assign\event\submission_updated $event
     */
    public static function handle_submission_updated(\mod_assign\event\submission_updated $event): void {
        // Future: invalidate cached submission data for this activity.
    }

    /**
     * Handle assignment submission removed event.
     *
     * Prunes the segment-anchored comments tied to the removed submission so a
     * retracted submission leaves no orphaned grader comments. A single batched
     * delete keyed by the submission id (no per-row queries).
     *
     * @param \mod_assign\event\submission_removed $event
     */
    public static function handle_submission_removed(\mod_assign\event\submission_removed $event): void {
        global $DB;

        $submissionid = (int) $event->objectid;
        if ($submissionid <= 0) {
            return;
        }
        $DB->delete_records('local_unifiedgrader_segcomment', ['submissionid' => $submissionid]);
    }

    /**
     * Handle course module deleted event.
     *
     * When an assignment module is deleted, prune its segment-anchored comments
     * (keyed by the course-module id) so they cannot linger. A single batched
     * delete (no per-row queries). Gated to assign modules; segcomment rows only
     * ever carry assign course-module ids.
     *
     * @param \core\event\course_module_deleted $event
     */
    public static function handle_course_module_deleted(\core\event\course_module_deleted $event): void {
        global $DB;

        if (($event->other['modulename'] ?? '') !== 'assign') {
            return;
        }
        $cmid = (int) $event->objectid;
        if ($cmid <= 0) {
            return;
        }
        $DB->delete_records('local_unifiedgrader_segcomment', ['cmid' => $cmid]);
    }
}
