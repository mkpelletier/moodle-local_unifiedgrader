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

/**
 * Tests for the submission-translation web service external functions.
 *
 * Covers capability enforcement on get_submission_translation and
 * confirm_student_language, and the graceful-degradation path taken when the
 * local_nida bridge class is absent (its \local\assign\submission_api is built
 * by a parallel package and is not present in this tree, so both externals must
 * report an 'unavailable' / not-saved result rather than error).
 *
 * @package    local_unifiedgrader
 * @category   test
 * @copyright  2026 South African Theological Seminary (mathieu@sats.ac.za)
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 * @covers \local_unifiedgrader\external\get_submission_translation
 * @covers \local_unifiedgrader\external\confirm_student_language
 */
final class translation_webservices_test extends \advanced_testcase {
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
     * get_submission_translation degrades to 'unavailable' when local_nida is absent.
     */
    public function test_get_submission_translation_unavailable_without_nida(): void {
        $this->resetAfterTest();

        // Guard: this assertion is only meaningful while the bridge class is absent.
        if (class_exists('\local_nida\local\assign\submission_api')) {
            $this->markTestSkipped('local_nida submission_api is present; unavailable path not exercised.');
        }

        $scenario = $this->create_scenario();

        $result = get_submission_translation::execute(
            $scenario->cm->id,
            $scenario->students[0]->id,
            -1,
        );

        $this->assertSame('unavailable', $result['status']);
        $this->assertFalse($result['hasmetadata']);
        $this->assertSame('', $result['detectedlang']);
        $this->assertSame([], $result['sources']);
    }

    /**
     * A student cannot fetch another student's submission translation.
     */
    public function test_get_submission_translation_denies_student(): void {
        $this->resetAfterTest();

        $scenario = $this->create_scenario();
        // Log in as a student and try to read a peer's translation.
        $this->setUser($scenario->students[0]);

        $this->expectException(\required_capability_exception::class);
        get_submission_translation::execute(
            $scenario->cm->id,
            $scenario->students[1]->id,
            -1,
        );
    }

    /**
     * A teacher from a different course cannot fetch this course's translation.
     */
    public function test_get_submission_translation_denies_foreign_teacher(): void {
        $this->resetAfterTest();

        $scenario = $this->create_scenario();
        // A teacher enrolled only in a second, unrelated course.
        $other = $this->create_scenario();

        $this->setUser($other->teacher);

        // A teacher of an unrelated course is not enrolled here, so the context
        // (login) gate denies access before the capability gate is reached — the
        // cross-course IDOR path. The capability gate itself is covered by the
        // denies_student tests (enrolled, but lacking the grade capability).
        $this->expectException(\core\exception\require_login_exception::class);
        get_submission_translation::execute(
            $scenario->cm->id,
            $scenario->students[0]->id,
            -1,
        );
    }

    /**
     * confirm_student_language degrades to not-saved when local_nida is absent.
     */
    public function test_confirm_student_language_unavailable_without_nida(): void {
        $this->resetAfterTest();

        if (class_exists('\local_nida\local\assign\submission_api')) {
            $this->markTestSkipped('local_nida submission_api is present; unavailable path not exercised.');
        }

        $scenario = $this->create_scenario();

        $result = confirm_student_language::execute(
            $scenario->cm->id,
            $scenario->students[0]->id,
            -1,
            'en',
        );

        $this->assertFalse($result['saved']);
        $this->assertSame('', $result['resolvedlang']);
    }

    /**
     * A student cannot confirm a language for another student's submission.
     */
    public function test_confirm_student_language_denies_student(): void {
        $this->resetAfterTest();

        $scenario = $this->create_scenario();
        $this->setUser($scenario->students[0]);

        $this->expectException(\required_capability_exception::class);
        confirm_student_language::execute(
            $scenario->cm->id,
            $scenario->students[1]->id,
            -1,
            'en',
        );
    }

    /**
     * A teacher from a different course cannot confirm this course's language.
     */
    public function test_confirm_student_language_denies_foreign_teacher(): void {
        $this->resetAfterTest();

        $scenario = $this->create_scenario();
        $other = $this->create_scenario();
        $this->setUser($other->teacher);

        // Not enrolled here: the context (login) gate denies the cross-course
        // actor before the capability gate. Capability denial for an enrolled
        // non-grader is covered by the denies_student test.
        $this->expectException(\core\exception\require_login_exception::class);
        confirm_student_language::execute(
            $scenario->cm->id,
            $scenario->students[0]->id,
            -1,
            'en',
        );
    }
}
