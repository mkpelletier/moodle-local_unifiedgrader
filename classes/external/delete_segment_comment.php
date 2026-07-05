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
 * External function: delete a segment-anchored comment.
 *
 * The comment is targeted by its own id; the cmid (hence the context and the
 * capability check) is resolved from the stored row, so a client cannot delete a
 * comment in a course they cannot grade. Deletion is author-scoped.
 *
 * @package    local_unifiedgrader
 * @copyright  2026 South African Theological Seminary (mathieu@sats.ac.za)
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

namespace local_unifiedgrader\external;

use core_external\external_api;
use core_external\external_function_parameters;
use core_external\external_single_structure;
use core_external\external_value;
use local_unifiedgrader\segment_comment_manager;

/**
 * Deletes a single segment-anchored comment (author-scoped).
 */
class delete_segment_comment extends external_api {
    /**
     * Parameter definition.
     * @return external_function_parameters
     */
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters([
            'id' => new external_value(PARAM_INT, 'Segment comment id to delete'),
        ]);
    }

    /**
     * Execute the function.
     *
     * @param int $id Segment comment id.
     * @return array
     */
    public static function execute(int $id): array {
        global $USER;

        $params = self::validate_parameters(self::execute_parameters(), [
            'id' => $id,
        ]);

        // Load the row first so the context is derived from the stored cmid — the
        // client's id is never trusted to name its own module context.
        $record = segment_comment_manager::get($params['id']);
        if (!$record) {
            throw new \moodle_exception('segcomment_notfound', 'local_unifiedgrader');
        }

        $context = \context_module::instance((int) $record->cmid);
        self::validate_context($context);
        require_capability('local/unifiedgrader:grade', $context);

        // Release the PHP session lock so concurrent grader AJAX does not serialize
        // behind this request. This handler does not write to $SESSION.
        \core\session\manager::write_close();

        // Author-scoped: a grader can only delete their own comment.
        if ((int) $record->authorid !== (int) $USER->id) {
            throw new \moodle_exception('segcomment_notowner', 'local_unifiedgrader');
        }

        segment_comment_manager::delete((int) $record->id, (int) $USER->id);

        $count = segment_comment_manager::count_for(
            (int) $record->cmid,
            (int) $record->userid,
            (int) $record->attemptnumber,
        );

        return [
            'success' => true,
            'count' => $count,
        ];
    }

    /**
     * Return definition.
     * @return external_single_structure
     */
    public static function execute_returns(): external_single_structure {
        return new external_single_structure([
            'success' => new external_value(PARAM_BOOL, 'Whether deletion succeeded'),
            'count' => new external_value(PARAM_INT, 'Remaining comment count for this student/attempt'),
        ]);
    }
}
