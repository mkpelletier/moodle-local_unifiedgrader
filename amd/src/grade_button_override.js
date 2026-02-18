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
 * Overrides the default Grade button to redirect to the Unified Grader.
 *
 * For assignments: rewrites the tertiary nav "Grade" button href.
 * For forums: intercepts the "Grade users" button click before the
 * inline grading drawer JS handles it.
 *
 * @module     local_unifiedgrader/grade_button_override
 * @copyright  2026 South African Theological Seminary
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

/**
 * Initialise the grade button override.
 *
 * @param {string} gradeUrl The Unified Grader URL.
 * @param {string} modname The activity module name ('assign' or 'forum').
 */
export const init = (gradeUrl, modname) => {
    if (modname === 'assign') {
        // The assignment "Grade" button is an <a> in the tertiary navigation bar.
        const btn = document.querySelector('.tertiary-navigation a.btn-primary');
        if (btn && btn.href && btn.href.includes('action=grader')) {
            btn.href = gradeUrl;
        }

        // Rewrite "Grade" links in the submissions table (action menu kebab items).
        // Each link points to /mod/assign/view.php?id=X&action=grader&userid=Y.
        // We rewrite to /local/unifiedgrader/grade.php?cmid=X&userid=Y.
        document.querySelectorAll('a[href*="action=grader"]').forEach((link) => {
            try {
                const url = new URL(link.href);
                const userid = url.searchParams.get('userid');
                if (userid) {
                    link.href = gradeUrl + '&userid=' + encodeURIComponent(userid);
                } else {
                    link.href = gradeUrl;
                }
            } catch {
                // Ignore malformed URLs.
            }
        });
    } else if (modname === 'forum') {
        // The forum "Grade users" button has data-grade-action="launch" and
        // triggers mod_forum/grades/grader JS. Use a capturing listener to
        // intercept before the forum module's handler fires.
        const btn = document.querySelector('[data-grade-action="launch"]');
        if (btn) {
            btn.addEventListener('click', (e) => {
                e.stopImmediatePropagation();
                e.preventDefault();
                window.location.href = gradeUrl;
            }, {capture: true});
        }
    }
};
