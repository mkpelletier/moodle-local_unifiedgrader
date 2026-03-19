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

defined('MOODLE_INTERNAL') || die();

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
     * Handle SATS Mail message_sent event.
     *
     * When a user replies to a submission comment thread via SATS Mail,
     * this syncs the reply back as a submission comment.
     *
     * @param \local_satsmail\event\message_sent $event
     */
    public static function handle_satsmail_reply(\local_satsmail\event\message_sent $event): void {
        if (!satsmail\bridge::is_available()) {
            return;
        }

        $messageid = $event->objectid;

        // Skip if this message was created by us (loop prevention).
        if (satsmail\bridge::is_mapped_message($messageid)) {
            return;
        }

        try {
            $message = \local_satsmail\message::get($messageid);
        } catch (\Throwable $e) {
            return;
        }

        // Check backward references to find if this is a reply to a mapped message.
        $references = $message->get_references(false);
        if (empty($references)) {
            return;
        }

        global $DB;

        foreach ($references as $refmsg) {
            $mapping = $DB->get_record('local_unifiedgrader_smmap', ['messageid' => $refmsg->id]);
            if (!$mapping) {
                continue;
            }

            // Found a mapped reference — this is a reply to a submission comment thread.
            $cmid = (int) $mapping->cmid;
            $studentuserid = (int) $mapping->userid;
            $authorid = $message->sender()->id;

            // Strip our header from the content if present.
            $content = $message->content;
            $headerend = strpos($content, '<hr>');
            if ($headerend !== false) {
                // Check if the header contains our marker pattern.
                $beforehr = substr($content, 0, $headerend);
                if (strpos($beforehr, 'Submission comment for') !== false) {
                    $content = trim(substr($content, $headerend + 4));
                }
            }

            if (empty(trim(strip_tags($content)))) {
                return;
            }

            // Create the submission comment.
            submission_comment_manager::add_comment($cmid, $studentuserid, $authorid, $content);

            // Send Moodle notification and mirror back to SATS Mail with proper header.
            // Loop prevention: the bridge stores the mapping immediately, and
            // is_mapped_message() at the top of this method will skip it.
            notification\submission_comment_notification::send($cmid, $studentuserid, $authorid, $content);

            // Store mapping for the new message (thread continuity).
            satsmail\bridge::store_mapping($cmid, $studentuserid, $messageid);

            // Only process the first match.
            return;
        }
    }
}
