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
 * Event fired when a student views their feedback in Unified Grader.
 *
 * @package    local_unifiedgrader
 * @copyright  2026 South African Theological Seminary (mathieu@sats.ac.za)
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

namespace local_unifiedgrader\event;

/**
 * Recorded each time a student loads the Unified Grader feedback viewer for
 * an activity. Consumed by analytics (gradereport_coifish, local_coifish) to
 * measure whether students engage with the feedback their teachers wrote.
 */
class feedback_viewed extends \core\event\base {
    /**
     * Set basic event properties.
     */
    protected function init() {
        $this->data['crud'] = 'r';
        $this->data['edulevel'] = self::LEVEL_PARTICIPATING;
    }

    /**
     * Localised event name (used in admin log reports).
     *
     * @return string
     */
    public static function get_name(): string {
        return get_string('event_feedback_viewed', 'local_unifiedgrader');
    }

    /**
     * Human-readable description.
     *
     * @return string
     */
    public function get_description(): string {
        return "The user with id '$this->userid' viewed Unified Grader feedback for course module '$this->contextinstanceid'.";
    }

    /**
     * URL where the event occurred.
     *
     * @return \moodle_url
     */
    public function get_url(): \moodle_url {
        return new \moodle_url('/local/unifiedgrader/view_feedback.php', [
            'cmid' => $this->contextinstanceid,
        ]);
    }
}
