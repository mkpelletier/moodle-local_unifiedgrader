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
 * Admin form for a system-default comment-library entry.
 *
 * @package    local_unifiedgrader
 * @copyright  2026 South African Theological Seminary (mathieu@sats.ac.za)
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

namespace local_unifiedgrader\form;

defined('MOODLE_INTERNAL') || die();

global $CFG;
require_once($CFG->libdir . '/formslib.php');

/**
 * Edit (or create) a system-default comment shown to every teacher
 * regardless of course.
 */
class system_comment_form extends \moodleform {
    /**
     * Form definition.
     */
    protected function definition() {
        $mform = $this->_form;
        $systemtags = $this->_customdata['systemtags'] ?? [];

        $mform->addElement('hidden', 'id', 0);
        $mform->setType('id', PARAM_INT);

        $mform->addElement(
            'textarea',
            'content',
            get_string('clib_comment_content', 'local_unifiedgrader'),
            ['rows' => 5, 'cols' => 60],
        );
        $mform->setType('content', PARAM_TEXT);
        $mform->addRule('content', null, 'required', null, 'client');

        // Tag picker — multi-select limited to system-default tags. Personal
        // tags are intentionally excluded: a system comment tagged with a
        // teacher's personal tag would render inconsistently for everyone else.
        if (!empty($systemtags)) {
            $options = [];
            foreach ($systemtags as $tag) {
                $options[$tag['id']] = $tag['name'];
            }
            $select = $mform->addElement(
                'select',
                'tagids',
                get_string('clib_tags', 'local_unifiedgrader'),
                $options,
                ['size' => min(8, max(3, count($options)))],
            );
            $select->setMultiple(true);
        } else {
            $mform->addElement(
                'static',
                'tagids_notice',
                get_string('clib_tags', 'local_unifiedgrader'),
                get_string('clib_no_system_tags_yet', 'local_unifiedgrader'),
            );
        }

        $this->add_action_buttons();
    }
}
