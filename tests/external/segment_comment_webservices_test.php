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

namespace local_unifiedgrader\external;

use local_unifiedgrader\segment_comment_manager;

/**
 * Tests for the segment-anchored comment web service external functions (Phase 2).
 *
 * Covers capability enforcement on save/get/delete, the author-forcing and
 * author-scoped-delete guards, the graceful-degradation path taken when the
 * local_nida anchor resolver is absent, and a manager CRUD round-trip.
 *
 * The durable anchor is computed by local_nida's
 * \local\assign\submission_api::resolve_source_anchor(), which is built by a
 * parallel package and is NOT present in this tree — so a full save through the
 * external necessarily degrades to a clear moodle_exception here. The stored-anchor
 * round-trip is therefore exercised through the manager (which the save external
 * writes to unchanged), and the resolver dependency is documented rather than mocked.
 *
 * The segcomment table itself is frozen and created by WP-P1; table-touching tests
 * skip cleanly when that schema is not yet present in the tree under test.
 *
 * @package    local_unifiedgrader
 * @category   test
 * @copyright  2026 South African Theological Seminary (mathieu@sats.ac.za)
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 * @covers \local_unifiedgrader\external\save_segment_comment
 * @covers \local_unifiedgrader\external\get_segment_comments
 * @covers \local_unifiedgrader\external\delete_segment_comment
 * @covers \local_unifiedgrader\segment_comment_manager
 */
final class segment_comment_webservices_test extends \advanced_testcase {
    /**
     * Helper: create an assignment grading scenario with the teacher logged in.
     *
     * @param array $options Options passed to create_grading_scenario.
     * @return \stdClass Scenario object.
     */
    private function create_scenario(array $options = []): \stdClass {
        $plugingen = $this->getDataGenerator()->get_plugin_generator('local_unifiedgrader');
        $scenario = $plugingen->create_grading_scenario('assign', $options);
        $this->setUser($scenario->teacher);
        return $scenario;
    }

    /**
     * Skip a test when the WP-P1 segcomment table is not present in this tree.
     */
    private function require_table(): void {
        global $DB;
        if (!$DB->get_manager()->table_exists('local_unifiedgrader_segcomment')) {
            $this->markTestSkipped('local_unifiedgrader_segcomment (WP-P1) not present in this tree.');
        }
    }

    /**
     * Helper: insert a segment comment directly via the manager.
     *
     * @param int $cmid Course module ID.
     * @param int $userid Student user ID.
     * @param int $authorid Author user ID.
     * @param string $anchortext The anchored phrase.
     * @param string $commenttext The comment HTML.
     * @param int $attempt Attempt number.
     * @return \stdClass The stored record.
     */
    private function make_comment(
        int $cmid,
        int $userid,
        int $authorid,
        string $anchortext = 'grace',
        string $commenttext = '<p>Good.</p>',
        int $attempt = 0
    ): \stdClass {
        return segment_comment_manager::create(
            $cmid,
            $userid,
            $authorid,
            0,
            $attempt,
            'onlinetext',
            0,
            5,
            0,
            5,
            $anchortext,
            $commenttext,
            FORMAT_HTML,
        );
    }

    // Manager CRUD round-trip.

    /**
     * create then get_for then get then count then delete (author-scoped) via the manager.
     */
    public function test_manager_round_trip(): void {
        $this->resetAfterTest();
        $this->require_table();

        $scenario = $this->create_scenario();
        $student = $scenario->students[0];

        $row = $this->make_comment($scenario->cm->id, $student->id, $scenario->teacher->id, 'unmerited favour');
        $this->assertGreaterThan(0, $row->id);

        $forattempt = segment_comment_manager::get_for($scenario->cm->id, $student->id, 0);
        $this->assertCount(1, $forattempt);
        $this->assertSame('unmerited favour', $forattempt[0]->anchortext);
        $this->assertSame('<p>Good.</p>', $forattempt[0]->commenttext);

        $single = segment_comment_manager::get((int) $row->id);
        $this->assertNotNull($single);
        $this->assertSame((int) $scenario->teacher->id, (int) $single->authorid);

        $this->assertSame(1, segment_comment_manager::count_for($scenario->cm->id, $student->id, 0));

        // Author-scoped delete: a non-author id deletes nothing.
        segment_comment_manager::delete((int) $row->id, (int) $student->id);
        $this->assertNotNull(segment_comment_manager::get((int) $row->id));

        // The author deletes their own row.
        segment_comment_manager::delete((int) $row->id, (int) $scenario->teacher->id);
        $this->assertNull(segment_comment_manager::get((int) $row->id));
    }

    // Tests for save_segment_comment.

    /**
     * End-to-end save through the external with local_nida present: the grader
     * saves a comment on a real online-text phrase, the durable anchor is resolved
     * from a stored alignment, and the row is retrievable. Regression guard for the
     * $CFG-scope fatal when resolve_submission required mod/assign/locallib.php from
     * function scope without a `global $CFG`.
     */
    public function test_save_execute_stores_resolved_anchor(): void {
        global $DB;
        $this->resetAfterTest();
        $this->require_table();
        if (!class_exists('\local_nida\local\assign\submission_api')) {
            $this->markTestSkipped('local_nida is not present; the resolver path is not exercised.');
        }

        $plugingen = $this->getDataGenerator()->get_plugin_generator('local_unifiedgrader');
        $scenario = $this->create_scenario();
        $student = $scenario->students[0];

        $this->setUser($student);
        $plugingen->create_assign_submission($scenario->activity, $student->id, '<p>Grace alone. Faith too.</p>');
        $submission = $DB->get_record(
            'assign_submission',
            ['assignment' => $scenario->activity->id, 'userid' => $student->id],
            '*',
            IGNORE_MULTIPLE
        );
        $context = \context_module::instance($scenario->cm->id);

        // Stored alignment for the submission's online text (source spans + 1:1 groups).
        $segmentid = $DB->insert_record('local_nida_segment', (object) [
            'contextid' => $context->id, 'component' => 'mod_assign', 'area' => 'submission',
            'itemid' => (int) $submission->id, 'fieldname' => 'onlinetext', 'sourcehash' => sha1('src'),
            'sourcelang' => 'fr', 'sourceexcerpt' => 'Grace alone.', 'authorid' => (int) $student->id,
            'timemodified' => time(),
        ]);
        $spans = '<span data-nida-seg="1">Grace alone.</span> <span data-nida-seg="2">Faith too.</span>';
        $DB->insert_record('local_nida_align', (object) [
            'segmentid' => $segmentid, 'targetlang' => 'en', 'srcannotated' => $spans, 'txannotated' => $spans,
            'groupsjson' => json_encode([[[1], [1]], [[2], [2]]]), 'status' => 'ok',
            'timecreated' => time(), 'timemodified' => time(),
        ]);

        // Save as the grader — exercises resolve_submission (locallib load) + resolver + create.
        $this->setUser($scenario->teacher);
        $result = \local_unifiedgrader\external\save_segment_comment::execute(
            (int) $scenario->cm->id,
            (int) $student->id,
            (int) $submission->attemptnumber,
            'onlinetext',
            0,
            [1],
            '<p>Define this term.</p>',
            FORMAT_HTML
        );
        $this->assertGreaterThan(0, $result['id']);
        $this->assertSame('Grace alone.', $result['anchortext']);

        $got = \local_unifiedgrader\external\get_segment_comments::execute(
            (int) $scenario->cm->id,
            (int) $student->id,
            (int) $submission->attemptnumber
        );
        $this->assertCount(1, $got['comments']);
    }

    /**
     * End-to-end save through the external on a FILE source: the grader comments on
     * a phrase in a translated PDF/DOCX. Regression guard for the segcomment_noanchor
     * failure where the client sent fileid 0 for a file source (the resolver rejects
     * fileid 0 for 'file'); the payload now carries the real {files}.id and the save
     * resolves the file's source segment.
     */
    public function test_save_execute_resolves_file_source_anchor(): void {
        global $DB;
        $this->resetAfterTest();
        $this->require_table();
        if (!class_exists('\local_nida\local\assign\submission_api')) {
            $this->markTestSkipped('local_nida is not present; the resolver path is not exercised.');
        }

        $plugingen = $this->getDataGenerator()->get_plugin_generator('local_unifiedgrader');
        $scenario = $this->create_scenario();
        $student = $scenario->students[0];

        $this->setUser($student);
        $plugingen->create_assign_submission($scenario->activity, $student->id, '<p>online</p>');
        $submission = $DB->get_record(
            'assign_submission',
            ['assignment' => $scenario->activity->id, 'userid' => $student->id],
            '*',
            IGNORE_MULTIPLE
        );
        $context = \context_module::instance($scenario->cm->id);

        // A real submission file, so file_belongs_to_submission() accepts its id.
        $file = get_file_storage()->create_file_from_string([
            'contextid' => $context->id, 'component' => 'assignsubmission_file',
            'filearea' => 'submission_files', 'itemid' => (int) $submission->id,
            'filepath' => '/', 'filename' => 'submission.pdf',
        ], 'dummy pdf bytes');
        $fileid = (int) $file->get_id();

        // Stored alignment for the file's extracted doctext, keyed by the file id.
        $segmentid = $DB->insert_record('local_nida_segment', (object) [
            'contextid' => $context->id, 'component' => 'mod_assign', 'area' => 'submissionfile',
            'itemid' => $fileid, 'fieldname' => 'doctext', 'sourcehash' => sha1('doc'),
            'sourcelang' => 'fr', 'sourceexcerpt' => 'Grace alone.', 'authorid' => (int) $student->id,
            'timemodified' => time(),
        ]);
        $spans = '<span data-nida-seg="1">Grace alone.</span> <span data-nida-seg="2">Faith too.</span>';
        $DB->insert_record('local_nida_align', (object) [
            'segmentid' => $segmentid, 'targetlang' => 'en', 'srcannotated' => $spans, 'txannotated' => $spans,
            'groupsjson' => json_encode([[[1], [1]], [[2], [2]]]), 'status' => 'ok',
            'timecreated' => time(), 'timemodified' => time(),
        ]);

        // The real fileid must resolve; a zero fileid (the old client bug) must not.
        $this->setUser($scenario->teacher);
        $result = \local_unifiedgrader\external\save_segment_comment::execute(
            (int) $scenario->cm->id,
            (int) $student->id,
            (int) $submission->attemptnumber,
            'file',
            $fileid,
            [1],
            '<p>Clarify this clause.</p>',
            FORMAT_HTML
        );
        $this->assertGreaterThan(0, $result['id']);
        $this->assertSame('file', $result['sourcetype']);
        $this->assertSame($fileid, (int) $result['fileid']);
        $this->assertSame('Grace alone.', $result['anchortext']);

        $this->expectException(\moodle_exception::class);
        \local_unifiedgrader\external\save_segment_comment::execute(
            (int) $scenario->cm->id,
            (int) $student->id,
            (int) $submission->attemptnumber,
            'file',
            0,
            [1],
            '<p>Should fail.</p>',
            FORMAT_HTML
        );
    }

    /**
     * A student cannot save a segment comment (no grade capability).
     */
    public function test_save_denies_student(): void {
        $this->resetAfterTest();

        $scenario = $this->create_scenario();
        $this->setUser($scenario->students[0]);

        $this->expectException(\required_capability_exception::class);
        save_segment_comment::execute(
            $scenario->cm->id,
            $scenario->students[1]->id,
            -1,
            'onlinetext',
            0,
            [0],
            '<p>Nope.</p>',
            FORMAT_HTML,
        );
    }

    /**
     * A teacher from a different course cannot save here (cross-course IDOR).
     */
    public function test_save_denies_foreign_teacher(): void {
        $this->resetAfterTest();

        $scenario = $this->create_scenario();
        $other = $this->create_scenario();
        $this->setUser($other->teacher);

        // Not enrolled here: the login/context gate denies before the capability gate.
        $this->expectException(\core\exception\require_login_exception::class);
        save_segment_comment::execute(
            $scenario->cm->id,
            $scenario->students[0]->id,
            -1,
            'onlinetext',
            0,
            [0],
            '<p>Nope.</p>',
            FORMAT_HTML,
        );
    }

    /**
     * save fails cleanly (clear exception) when the local_nida resolver is absent —
     * it must never store a bogus anchor.
     */
    public function test_save_degrades_without_nida(): void {
        $this->resetAfterTest();

        if (class_exists('\local_nida\local\assign\submission_api')) {
            $this->markTestSkipped('local_nida submission_api is present; the degrade path is not exercised.');
        }

        $scenario = $this->create_scenario();

        $this->expectException(\moodle_exception::class);
        save_segment_comment::execute(
            $scenario->cm->id,
            $scenario->students[0]->id,
            -1,
            'onlinetext',
            0,
            [0],
            '<p>Anchored?</p>',
            FORMAT_HTML,
        );
    }

    /**
     * save rejects an unsupported source type before touching the resolver.
     */
    public function test_save_rejects_bad_source(): void {
        $this->resetAfterTest();

        $scenario = $this->create_scenario();

        $this->expectException(\moodle_exception::class);
        save_segment_comment::execute(
            $scenario->cm->id,
            $scenario->students[0]->id,
            -1,
            'bogus',
            0,
            [0],
            '<p>x</p>',
            FORMAT_HTML,
        );
    }

    // Tests for get_segment_comments.

    /**
     * A student cannot fetch a student's segment comments.
     */
    public function test_get_denies_student(): void {
        $this->resetAfterTest();

        $scenario = $this->create_scenario();
        $this->setUser($scenario->students[0]);

        $this->expectException(\required_capability_exception::class);
        get_segment_comments::execute($scenario->cm->id, $scenario->students[1]->id, -1);
    }

    /**
     * A teacher reads back the stored comments, with author display name.
     */
    public function test_get_returns_stored_comments(): void {
        $this->resetAfterTest();
        $this->require_table();

        $scenario = $this->create_scenario();
        $student = $scenario->students[0];

        $this->make_comment($scenario->cm->id, $student->id, $scenario->teacher->id, 'faith', '<p>One</p>');
        $this->make_comment($scenario->cm->id, $student->id, $scenario->teacher->id, 'hope', '<p>Two</p>');

        $result = get_segment_comments::execute($scenario->cm->id, $student->id, -1);
        $this->assertCount(2, $result['comments']);
        $anchors = array_column($result['comments'], 'anchortext');
        $this->assertContains('faith', $anchors);
        $this->assertContains('hope', $anchors);
        $this->assertNotSame('', $result['comments'][0]['authorfullname']);
        $this->assertSame((int) $scenario->teacher->id, $result['comments'][0]['authorid']);
    }

    // Tests for delete_segment_comment.

    /**
     * The author (a grader) can delete their own comment; the count updates.
     */
    public function test_delete_by_author_succeeds(): void {
        $this->resetAfterTest();
        $this->require_table();

        $scenario = $this->create_scenario();
        $student = $scenario->students[0];
        $row = $this->make_comment($scenario->cm->id, $student->id, $scenario->teacher->id);

        $result = delete_segment_comment::execute((int) $row->id);
        $this->assertTrue($result['success']);
        $this->assertSame(0, $result['count']);
        $this->assertNull(segment_comment_manager::get((int) $row->id));
    }

    /**
     * A grader cannot delete another author's comment (author-scoped).
     */
    public function test_delete_rejects_non_author(): void {
        $this->resetAfterTest();
        $this->require_table();

        $scenario = $this->create_scenario();
        $student = $scenario->students[0];
        // Authored by the student, not the grader.
        $row = $this->make_comment($scenario->cm->id, $student->id, $student->id);

        // The teacher has the grade capability but is not the author.
        $this->expectException(\moodle_exception::class);
        delete_segment_comment::execute((int) $row->id);
    }

    /**
     * A student cannot delete a comment (no grade capability).
     */
    public function test_delete_denies_student(): void {
        $this->resetAfterTest();
        $this->require_table();

        $scenario = $this->create_scenario();
        $student = $scenario->students[0];
        $row = $this->make_comment($scenario->cm->id, $student->id, $scenario->teacher->id);

        $this->setUser($student);
        $this->expectException(\required_capability_exception::class);
        delete_segment_comment::execute((int) $row->id);
    }

    /**
     * A teacher from a different course cannot delete this course's comment: the
     * context is resolved from the stored row, so the cross-course actor is denied.
     */
    public function test_delete_denies_foreign_teacher(): void {
        $this->resetAfterTest();
        $this->require_table();

        $scenario = $this->create_scenario();
        $student = $scenario->students[0];
        $row = $this->make_comment($scenario->cm->id, $student->id, $scenario->teacher->id);

        $other = $this->create_scenario();
        $this->setUser($other->teacher);

        $this->expectException(\core\exception\require_login_exception::class);
        delete_segment_comment::execute((int) $row->id);
    }
}
