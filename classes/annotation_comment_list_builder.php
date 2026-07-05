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
 * Pure builder for the student-facing translated annotation-comment list.
 *
 * Turns raw grader annotation sources (UG Fabric.js annotation JSON keyed by page,
 * plus assignfeedback_editpdf comment rows) into a page-keyed list of comment
 * texts. Translation is injected via a resolver callable so the builder stays
 * pure and unit-testable — it performs no database access of its own.
 *
 * @package    local_unifiedgrader
 * @copyright  2026 South African Theological Seminary (mathieu@sats.ac.za)
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

namespace local_unifiedgrader;

/**
 * Builds a page-keyed list of annotation comment texts (original + translation).
 */
class annotation_comment_list_builder {
    /**
     * Extract the comment texts from a single page's Fabric.js annotation JSON.
     *
     * Fabric objects carry the teacher's comment in an `annotationText` property
     * (see amd/src/annotation/types.js). Objects without one (highlights, shapes)
     * are skipped. Order within the page is preserved.
     *
     * @param string $annotationdata The raw Fabric.js canvas JSON for one page.
     * @return string[] Non-empty comment texts in document order.
     */
    public static function extract_page_texts(string $annotationdata): array {
        $texts = [];
        if ($annotationdata === '' || $annotationdata === '{}') {
            return $texts;
        }
        $parsed = json_decode($annotationdata, true);
        if (!is_array($parsed) || empty($parsed['objects']) || !is_array($parsed['objects'])) {
            return $texts;
        }
        foreach ($parsed['objects'] as $object) {
            if (!is_array($object)) {
                continue;
            }
            $text = $object['annotationText'] ?? '';
            if (is_string($text) && trim($text) !== '') {
                $texts[] = $text;
            }
        }
        return $texts;
    }

    /**
     * Build the page-keyed annotation comment list.
     *
     * @param array $pages List of ['pagenum' => int, 'annotationdata' => string]
     *                     rows (UG Fabric.js annotations) plus optional
     *                     ['pagenum' => int, 'text' => string] rows for editpdf
     *                     comments already extracted as plain text.
     * @param callable $resolver fn(string $text): ?string — returns the translated
     *                     text for a source string, or null when none exists.
     * @return array List of ['page' => int, 'comments' => [['original', 'translated',
     *               'hastranslation']]] ordered by page number ascending.
     */
    public static function build(array $pages, callable $resolver): array {
        // Group comment source texts by page number, preserving order.
        $bypage = [];
        foreach ($pages as $row) {
            $pagenum = (int) ($row['pagenum'] ?? 0);
            if (!isset($bypage[$pagenum])) {
                $bypage[$pagenum] = [];
            }
            if (array_key_exists('text', $row)) {
                // Pre-extracted plain text (editpdf comment).
                $text = (string) $row['text'];
                if (trim($text) !== '') {
                    $bypage[$pagenum][] = $text;
                }
            } else {
                // Raw Fabric.js JSON (UG annotation) — may hold several comments.
                foreach (self::extract_page_texts((string) ($row['annotationdata'] ?? '')) as $text) {
                    $bypage[$pagenum][] = $text;
                }
            }
        }

        ksort($bypage, SORT_NUMERIC);

        $result = [];
        foreach ($bypage as $pagenum => $texts) {
            $comments = [];
            foreach ($texts as $text) {
                $translated = $resolver($text);
                $comments[] = [
                    'original' => $text,
                    'translated' => $translated,
                    'hastranslation' => $translated !== null,
                ];
            }
            if (!empty($comments)) {
                $result[] = [
                    'page' => $pagenum,
                    'comments' => $comments,
                ];
            }
        }

        return $result;
    }
}
