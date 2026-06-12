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

namespace local_unifiedgrader\manager;

use local_unifiedgrader\referral_manager;

/**
 * Tests for the academic-integrity referral manager.
 *
 * @package    local_unifiedgrader
 * @category   test
 * @copyright  2026 South African Theological Seminary (mathieu@sats.ac.za)
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 * @covers \local_unifiedgrader\referral_manager
 */
final class referral_manager_test extends \advanced_testcase {
    /**
     * Build a course module, teacher, and student for a test.
     *
     * @return array{0: \cm_info|\stdClass, 1: \stdClass, 2: \stdClass}
     */
    private function make_fixture(): array {
        $gen = $this->getDataGenerator();
        $course = $gen->create_course();
        $assign = $gen->create_module('assign', ['course' => $course->id]);
        $cm = get_coursemodule_from_instance('assign', $assign->id);
        $teacher = $gen->create_user();
        $student = $gen->create_user();
        return [$cm, $teacher, $student];
    }

    /**
     * Test refer creates a row with the expected open state.
     */
    public function test_refer_creates_row(): void {
        global $DB;
        $this->resetAfterTest();

        [$cm, $teacher, $student] = $this->make_fixture();

        $id = referral_manager::refer($cm->id, $student->id, $teacher->id, 'integrity', 'Suspicious overlap');
        $this->assertGreaterThan(0, $id);

        $record = $DB->get_record('local_unifiedgrader_referral', ['id' => $id], '*', MUST_EXIST);
        $this->assertEquals($cm->id, $record->cmid);
        $this->assertEquals($student->id, $record->userid);
        $this->assertEquals($teacher->id, $record->authorid);
        $this->assertEquals('integrity', $record->reason);
        $this->assertEquals('Suspicious overlap', $record->note);
        $this->assertEquals('open', $record->status);
        $this->assertGreaterThan(0, (int) $record->timereferred);
        $this->assertEquals(0, (int) $record->timeresolved);
    }

    /**
     * Test refer defaults: reason 'integrity', null note when empty.
     */
    public function test_refer_defaults(): void {
        global $DB;
        $this->resetAfterTest();

        [$cm, $teacher, $student] = $this->make_fixture();

        $id = referral_manager::refer($cm->id, $student->id, $teacher->id);

        $record = $DB->get_record('local_unifiedgrader_referral', ['id' => $id], '*', MUST_EXIST);
        $this->assertEquals('integrity', $record->reason);
        $this->assertNull($record->note);
    }

    /**
     * Test idempotency: a second refer on the same open pair returns the same id without duplicating.
     */
    public function test_refer_idempotent(): void {
        global $DB;
        $this->resetAfterTest();

        [$cm, $teacher, $student] = $this->make_fixture();

        $first = referral_manager::refer($cm->id, $student->id, $teacher->id);
        $second = referral_manager::refer($cm->id, $student->id, $teacher->id, 'integrity', 'ignored note');

        $this->assertEquals($first, $second);
        $this->assertEquals(1, $DB->count_records('local_unifiedgrader_referral', [
            'cmid' => $cm->id,
            'userid' => $student->id,
        ]));
    }

    /**
     * Test resolve sets status, outcome, and timeresolved.
     */
    public function test_resolve(): void {
        global $DB;
        $this->resetAfterTest();

        [$cm, $teacher, $student] = $this->make_fixture();

        $id = referral_manager::refer($cm->id, $student->id, $teacher->id);
        $result = referral_manager::resolve($id, 'upheld');
        $this->assertTrue($result);

        $record = $DB->get_record('local_unifiedgrader_referral', ['id' => $id], '*', MUST_EXIST);
        $this->assertEquals('resolved', $record->status);
        $this->assertEquals('upheld', $record->outcome);
        $this->assertGreaterThan(0, (int) $record->timeresolved);
    }

    /**
     * Test get_open returns the open referral, then null after resolution.
     */
    public function test_get_open(): void {
        $this->resetAfterTest();

        [$cm, $teacher, $student] = $this->make_fixture();

        $this->assertNull(referral_manager::get_open($cm->id, $student->id));

        $id = referral_manager::refer($cm->id, $student->id, $teacher->id);
        $open = referral_manager::get_open($cm->id, $student->id);
        $this->assertIsArray($open);
        $this->assertEquals($id, $open['id']);
        $this->assertSame('open', $open['status']);
        $this->assertIsInt($open['cmid']);
        $this->assertIsInt($open['userid']);
        $this->assertIsInt($open['authorid']);

        referral_manager::resolve($id, 'cleared');
        $this->assertNull(referral_manager::get_open($cm->id, $student->id));
    }

    /**
     * Test that after resolving, a fresh refer creates a new open referral.
     */
    public function test_refer_after_resolve_creates_new(): void {
        global $DB;
        $this->resetAfterTest();

        [$cm, $teacher, $student] = $this->make_fixture();

        $first = referral_manager::refer($cm->id, $student->id, $teacher->id);
        referral_manager::resolve($first, 'cleared');
        $second = referral_manager::refer($cm->id, $student->id, $teacher->id);

        $this->assertNotEquals($first, $second);
        $this->assertEquals(2, $DB->count_records('local_unifiedgrader_referral', [
            'cmid' => $cm->id,
            'userid' => $student->id,
        ]));
    }

    /**
     * Test get_for_activity returns all referrals newest first.
     */
    public function test_get_for_activity(): void {
        $this->resetAfterTest();

        [$cm, $teacher, $student] = $this->make_fixture();

        $this->assertSame([], referral_manager::get_for_activity($cm->id, $student->id));

        $first = referral_manager::refer($cm->id, $student->id, $teacher->id);
        referral_manager::resolve($first, 'cleared');
        $second = referral_manager::refer($cm->id, $student->id, $teacher->id);

        $all = referral_manager::get_for_activity($cm->id, $student->id);
        $this->assertCount(2, $all);
        // Newest first: the second (most recent timereferred / highest id) leads.
        $this->assertEquals($second, $all[0]['id']);
        $this->assertEquals($first, $all[1]['id']);
    }

    /**
     * Test referrals are scoped to the correct student.
     */
    public function test_referrals_scoped_to_student(): void {
        $this->resetAfterTest();

        $gen = $this->getDataGenerator();
        $course = $gen->create_course();
        $assign = $gen->create_module('assign', ['course' => $course->id]);
        $cm = get_coursemodule_from_instance('assign', $assign->id);
        $teacher = $gen->create_user();
        $student1 = $gen->create_user();
        $student2 = $gen->create_user();

        referral_manager::refer($cm->id, $student1->id, $teacher->id);

        $this->assertNotNull(referral_manager::get_open($cm->id, $student1->id));
        $this->assertNull(referral_manager::get_open($cm->id, $student2->id));
    }
}
