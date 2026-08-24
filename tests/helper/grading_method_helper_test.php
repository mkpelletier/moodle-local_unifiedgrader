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

namespace local_unifiedgrader;

use advanced_testcase;

/**
 * Tests for the advanced grading method helper.
 *
 * @package    local_unifiedgrader
 * @category   test
 * @copyright  2026 South African Theological Seminary
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
#[\PHPUnit\Framework\Attributes\CoversClass(grading_method_helper::class)]
final class grading_method_helper_test extends advanced_testcase {
    /**
     * Both rubric flavours must be recognised as rubrics.
     */
    public function test_is_rubric(): void {
        $this->assertTrue(grading_method_helper::is_rubric('rubric'));
        $this->assertTrue(grading_method_helper::is_rubric('rubric_ranges'));
        $this->assertFalse(grading_method_helper::is_rubric('guide'));
        $this->assertFalse(grading_method_helper::is_rubric('quizmanual'));
        $this->assertFalse(grading_method_helper::is_rubric(null));
    }

    /**
     * Only the ranged flavour reports ranged support.
     */
    public function test_is_ranged_rubric(): void {
        $this->assertTrue(grading_method_helper::is_ranged_rubric('rubric_ranges'));
        $this->assertFalse(grading_method_helper::is_ranged_rubric('rubric'));
        $this->assertFalse(grading_method_helper::is_ranged_rubric(null));
    }

    /**
     * Ascending bands start at zero and each subsequent band starts one point
     * above the previous level, matching display_range_score().
     */
    public function test_annotate_ranged_criteria_ascending(): void {
        $this->resetAfterTest();

        $criteria = [
            [
                'id' => 7,
                'levels' => [
                    ['id' => 1, 'score' => 5.0],
                    ['id' => 2, 'score' => 10.0],
                    ['id' => 3, 'score' => 20.0],
                ],
            ],
        ];
        $raw = [7 => ['isranged' => 1, 'points' => 20]];

        $result = grading_method_helper::annotate_ranged_criteria($criteria, $raw);

        $this->assertTrue($result[0]['isranged']);
        $this->assertEquals(20.0, $result[0]['points']);
        $this->assertSame('0 to 5', $result[0]['levels'][0]['rangelabel']);
        $this->assertSame('6 to 10', $result[0]['levels'][1]['rangelabel']);
        $this->assertSame('11 to 20', $result[0]['levels'][2]['rangelabel']);
    }

    /**
     * Descending order yields the same intervals, written high to low.
     */
    public function test_annotate_ranged_criteria_descending(): void {
        $this->resetAfterTest();

        $criteria = [
            [
                'id' => 7,
                'levels' => [
                    ['id' => 3, 'score' => 20.0],
                    ['id' => 2, 'score' => 10.0],
                    ['id' => 1, 'score' => 5.0],
                ],
            ],
        ];
        $raw = [7 => ['isranged' => 1, 'points' => 20]];

        $result = grading_method_helper::annotate_ranged_criteria($criteria, $raw, false);

        $this->assertSame('20 to 11', $result[0]['levels'][0]['rangelabel']);
        $this->assertSame('10 to 6', $result[0]['levels'][1]['rangelabel']);
        $this->assertSame('5 to 0', $result[0]['levels'][2]['rangelabel']);
    }

    /**
     * A criterion that is not ranged gets no band labels.
     */
    public function test_annotate_leaves_unranged_criteria_alone(): void {
        $this->resetAfterTest();

        $criteria = [
            [
                'id' => 7,
                'levels' => [
                    ['id' => 1, 'score' => 5.0],
                    ['id' => 2, 'score' => 10.0],
                ],
            ],
        ];
        $raw = [7 => ['isranged' => 0, 'points' => 10]];

        $result = grading_method_helper::annotate_ranged_criteria($criteria, $raw);

        $this->assertFalse($result[0]['isranged']);
        $this->assertArrayNotHasKey('rangelabel', $result[0]['levels'][0]);
        $this->assertArrayNotHasKey('rangelabel', $result[0]['levels'][1]);
    }

    /**
     * The PDF link is offered for ranged rubrics only.
     */
    public function test_get_pdf_url(): void {
        $this->resetAfterTest();

        $url = grading_method_helper::get_pdf_url('rubric_ranges', 42);
        $this->assertIsString($url);
        $this->assertStringContainsString('/grade/grading/form/rubric_ranges/print.php', $url);
        $this->assertStringContainsString('areaid=42', $url);

        // Core rubric has no printable export, and a missing area yields nothing.
        $this->assertNull(grading_method_helper::get_pdf_url('rubric', 42));
        $this->assertNull(grading_method_helper::get_pdf_url('guide', 42));
        $this->assertNull(grading_method_helper::get_pdf_url('rubric_ranges', 0));
    }
}
