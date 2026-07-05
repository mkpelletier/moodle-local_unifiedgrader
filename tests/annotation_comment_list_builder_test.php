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

/**
 * Tests for the pure annotation_comment_list_builder.
 *
 * @package    local_unifiedgrader
 * @category   test
 * @copyright  2026 South African Theological Seminary (mathieu@sats.ac.za)
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 * @covers \local_unifiedgrader\annotation_comment_list_builder
 */
final class annotation_comment_list_builder_test extends \basic_testcase {
    /**
     * Build a Fabric.js canvas JSON string with the given annotation texts.
     *
     * @param array $texts Comment texts; empty string means an object with no annotationText.
     * @return string
     */
    private function fabric(array $texts): string {
        $objects = [];
        foreach ($texts as $text) {
            $obj = ['type' => 'rect'];
            if ($text !== null) {
                $obj['annotationText'] = $text;
            }
            $objects[] = $obj;
        }
        return json_encode(['objects' => $objects]);
    }

    /**
     * extract_page_texts pulls only non-empty annotationText values, in order.
     */
    public function test_extract_page_texts(): void {
        $json = $this->fabric(['First note', '', 'Second note', null]);
        $texts = annotation_comment_list_builder::extract_page_texts($json);
        $this->assertSame(['First note', 'Second note'], $texts);
    }

    /**
     * extract_page_texts tolerates empty and malformed input.
     */
    public function test_extract_page_texts_empty_and_malformed(): void {
        $this->assertSame([], annotation_comment_list_builder::extract_page_texts(''));
        $this->assertSame([], annotation_comment_list_builder::extract_page_texts('{}'));
        $this->assertSame([], annotation_comment_list_builder::extract_page_texts('not json'));
        $this->assertSame([], annotation_comment_list_builder::extract_page_texts('{"objects":[]}'));
    }

    /**
     * build groups comments by page, ordered ascending, resolving translations.
     */
    public function test_build_page_keyed_with_translations(): void {
        $pages = [
            ['pagenum' => 2, 'annotationdata' => $this->fabric(['Good point'])],
            ['pagenum' => 1, 'annotationdata' => $this->fabric(['Needs work', 'See here'])],
            ['pagenum' => 1, 'text' => 'Editpdf comment'],
        ];

        // Resolver translates only known strings.
        $dictionary = [
            'Needs work' => 'Besoin de travail',
            'Editpdf comment' => 'Commentaire editpdf',
        ];
        $resolver = function (string $text) use ($dictionary): ?string {
            return $dictionary[$text] ?? null;
        };

        $result = annotation_comment_list_builder::build($pages, $resolver);

        // Two pages, ordered 1 then 2.
        $this->assertCount(2, $result);
        $this->assertSame(1, $result[0]['page']);
        $this->assertSame(2, $result[1]['page']);

        // Page 1 has three comments in insertion order.
        $page1 = $result[0]['comments'];
        $this->assertCount(3, $page1);
        $this->assertSame('Needs work', $page1[0]['original']);
        $this->assertSame('Besoin de travail', $page1[0]['translated']);
        $this->assertTrue($page1[0]['hastranslation']);

        // The 'See here' note has no translation.
        $this->assertSame('See here', $page1[1]['original']);
        $this->assertNull($page1[1]['translated']);
        $this->assertFalse($page1[1]['hastranslation']);

        // Editpdf plain-text comment.
        $this->assertSame('Editpdf comment', $page1[2]['original']);
        $this->assertSame('Commentaire editpdf', $page1[2]['translated']);

        // Page 2 has a single untranslated comment.
        $page2 = $result[1]['comments'];
        $this->assertCount(1, $page2);
        $this->assertSame('Good point', $page2[0]['original']);
        $this->assertFalse($page2[0]['hastranslation']);
    }

    /**
     * build returns an empty list when there are no comment texts.
     */
    public function test_build_empty(): void {
        $pages = [
            ['pagenum' => 1, 'annotationdata' => '{}'],
            ['pagenum' => 2, 'text' => '   '],
        ];
        $resolver = function (string $text): ?string {
            unset($text);
            return null;
        };
        $this->assertSame([], annotation_comment_list_builder::build($pages, $resolver));
    }
}
