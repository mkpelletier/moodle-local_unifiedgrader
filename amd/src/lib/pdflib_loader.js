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
 * pdf-lib library loader
 *
 * Loads pdf-lib via RequireJS from the thirdparty directory.
 * The pdf-lib UMD build is AMD-compatible and registers with define().
 *
 * @module     local_unifiedgrader/lib/pdflib_loader
 * @package    local_unifiedgrader
 * @copyright  2026 South African Theological Seminary (mathieu@sats.ac.za)
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
define([], function() {

    /** @type {?object} Cached pdf-lib library reference. */
    let pdflibLib = null;

    /** @type {?Promise} Loading promise to prevent duplicate loads. */
    let loadPromise = null;

    return {
        /**
         * Load the pdf-lib library.
         *
         * @returns {Promise<object>} The PDFLib namespace.
         */
        load: function() {
            if (pdflibLib) {
                return Promise.resolve(pdflibLib);
            }
            if (loadPromise) {
                return loadPromise;
            }

            const url = M.cfg.wwwroot + '/local/unifiedgrader/thirdparty/pdflib/pdf-lib.min.js';

            loadPromise = new Promise(function(resolve, reject) {
                // Use RequireJS require() to load the UMD build.
                // RequireJS handles AMD detection in the UMD wrapper.
                require([url], function(PDFLib) {
                    pdflibLib = PDFLib;
                    resolve(pdflibLib);
                }, function(err) {
                    reject(err);
                });
            });

            return loadPromise;
        },
    };
});
