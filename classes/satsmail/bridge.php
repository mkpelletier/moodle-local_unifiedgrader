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
 * Bridge between submission comments and SATS Mail.
 *
 * When installed and enabled, submission comments are mirrored as
 * SATS Mail messages so that users can reply from their mailbox.
 *
 * @package    local_unifiedgrader
 * @copyright  2026 South African Theological Seminary (mathieu@sats.ac.za)
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

namespace local_unifiedgrader\satsmail;

defined('MOODLE_INTERNAL') || die();

/**
 * Static utility class bridging submission comments to SATS Mail.
 */
class bridge {

    /** @var int Maximum label name length. */
    private const LABEL_MAX_LENGTH = 15;

    /** @var string Label colour for submission comment labels. */
    private const LABEL_COLOR = 'blue';

    /**
     * Check whether SATS Mail integration is available and enabled.
     *
     * @return bool
     */
    public static function is_available(): bool {
        return class_exists('\local_satsmail\message')
            && (bool) get_config('local_unifiedgrader', 'enable_satsmail');
    }

    /**
     * Send a submission comment as a SATS Mail message.
     *
     * Creates a new thread or replies to an existing one for the
     * (cmid, studentuserid) pair.
     *
     * @param int $cmid Course module ID.
     * @param int $studentuserid Student the thread is about.
     * @param int $authorid User who posted the comment.
     * @param string $content Comment content.
     */
    public static function send_comment_as_mail(int $cmid, int $studentuserid, int $authorid, string $content): void {
        if (!self::is_available()) {
            return;
        }

        try {
            [$course, $cm] = get_course_and_cm_from_cmid($cmid);
        } catch (\Throwable $e) {
            return;
        }

        $context = \context_module::instance($cmid);
        $activityname = format_string($cm->name, true, ['context' => $context]);

        $sender = \local_satsmail\user::get($authorid);
        $smcourse = \local_satsmail\course::get($course->id);

        // Determine recipients and the appropriate URL for them.
        // Teacher→student: student sees assignment view. Student→teacher: teacher sees grader.
        $isgrader = has_capability('local/unifiedgrader:grade', $context, $authorid);
        $recipients = [];

        if ($isgrader) {
            // Teacher sent → student receives → link to assignment view.
            $recipients[] = \local_satsmail\user::get($studentuserid);
            $activityurl = (new \moodle_url('/mod/assign/view.php', ['id' => $cmid]))->out(false);
        } else {
            // Student sent → teachers receive → link to unified grader.
            $graders = get_enrolled_users($context, 'local/unifiedgrader:grade');
            foreach ($graders as $grader) {
                if ((int) $grader->id !== $authorid) {
                    $recipients[] = \local_satsmail\user::get($grader->id);
                }
            }
            $activityurl = (new \moodle_url('/local/unifiedgrader/grade.php', [
                'cmid' => $cmid,
                'userid' => $studentuserid,
            ]))->out(false);
        }

        if (empty($recipients)) {
            return;
        }

        // Build message content with header.
        $header = get_string('satsmail_comment_header', 'local_unifiedgrader', (object) [
            'activityname' => $activityname,
            'activityurl' => $activityurl,
        ]);
        $fullcontent = $header . $content;

        // Subject line.
        $subject = shorten_text(get_string('satsmail_comment_subject', 'local_unifiedgrader', $activityname), 80, true);

        // Check for existing thread.
        $existingmsg = self::get_thread_message($cmid, $studentuserid);

        if ($existingmsg) {
            // Reply to existing thread.
            $data = \local_satsmail\message_data::reply($existingmsg, $sender, true);
        } else {
            // New message.
            $data = \local_satsmail\message_data::new($smcourse, $sender);
            $data->to = $recipients;
        }

        $data->subject = $subject;
        $data->content = $fullcontent;
        $data->format = FORMAT_HTML;
        $data->time = time();

        $message = \local_satsmail\message::create($data);
        $message->send(time());

        // Apply label to sender.
        $label = self::find_or_create_label($sender, $activityname);
        $message->set_labels($sender, [$label]);

        // Store mapping for loop prevention and thread continuity.
        self::store_mapping($cmid, $studentuserid, $message->id);

        // Trigger the event (mirrors what external.php::send_message does).
        \local_satsmail\event\message_sent::create_from_message($message)->trigger();
    }

    /**
     * Find or create a label for the sender based on activity name.
     *
     * @param \local_satsmail\user $user The sender.
     * @param string $activityname The activity name.
     * @return \local_satsmail\label The label.
     */
    public static function find_or_create_label(\local_satsmail\user $user, string $activityname): \local_satsmail\label {
        $truncated = self::truncate_label($activityname);

        $existinglabels = \local_satsmail\label::get_by_user($user);
        foreach ($existinglabels as $label) {
            if ($label->name === $truncated) {
                return $label;
            }
        }

        return \local_satsmail\label::create($user, $truncated, self::LABEL_COLOR);
    }

    /**
     * Get the most recent SATS Mail message for a thread (cmid + userid pair).
     *
     * @param int $cmid Course module ID.
     * @param int $userid Student user ID.
     * @return \local_satsmail\message|null The message, or null if no thread exists.
     */
    public static function get_thread_message(int $cmid, int $userid): ?\local_satsmail\message {
        global $DB;

        $record = $DB->get_record_sql(
            "SELECT messageid
               FROM {local_unifiedgrader_smmap}
              WHERE cmid = :cmid AND userid = :userid
           ORDER BY timecreated DESC
              LIMIT 1",
            ['cmid' => $cmid, 'userid' => $userid]
        );

        if (!$record) {
            return null;
        }

        try {
            return \local_satsmail\message::get($record->messageid);
        } catch (\Throwable $e) {
            return null;
        }
    }

    /**
     * Check whether a SATS Mail message ID is already in our mapping table.
     *
     * Used for loop prevention — if a message was created by us, the
     * observer should not process it again.
     *
     * @param int $messageid The SATS Mail message ID.
     * @return bool
     */
    public static function is_mapped_message(int $messageid): bool {
        global $DB;
        return $DB->record_exists('local_unifiedgrader_smmap', ['messageid' => $messageid]);
    }

    /**
     * Store a mapping between a SATS Mail message and a submission comment thread.
     *
     * @param int $cmid Course module ID.
     * @param int $userid Student user ID.
     * @param int $messageid SATS Mail message ID.
     */
    public static function store_mapping(int $cmid, int $userid, int $messageid): void {
        global $DB;

        $DB->insert_record('local_unifiedgrader_smmap', (object) [
            'cmid' => $cmid,
            'userid' => $userid,
            'messageid' => $messageid,
            'timecreated' => time(),
        ]);
    }

    /**
     * Truncate a label name to the maximum length.
     *
     * @param string $name The label name.
     * @return string Truncated name.
     */
    private static function truncate_label(string $name): string {
        if (\core_text::strlen($name) <= self::LABEL_MAX_LENGTH) {
            return $name;
        }
        return \core_text::substr($name, 0, self::LABEL_MAX_LENGTH - 1) . '…';
    }
}
