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
 * Fabric.js library loader
 *
 * Loads Fabric.js via RequireJS from the thirdparty directory.
 * The Fabric.js UMD build is AMD-compatible and registers with define().
 *
 * @module     local_unifiedgrader/lib/fabric_loader
 * @package    local_unifiedgrader
 * @copyright  2026 South African Theological Seminary (mathieu@sats.ac.za)
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
define([], function() {

    /** @type {?object} Cached Fabric.js library reference. */
    let fabricLib = null;

    /** @type {?Promise} Loading promise to prevent duplicate loads. */
    let loadPromise = null;

    return {
        /**
         * Load the Fabric.js library.
         *
         * @returns {Promise<object>} The fabric namespace.
         */
        load: function() {
            if (fabricLib) {
                return Promise.resolve(fabricLib);
            }
            if (loadPromise) {
                return loadPromise;
            }

            const url = M.cfg.wwwroot + '/local/unifiedgrader/thirdparty/fabric/fabric.js';

            loadPromise = new Promise(function(resolve, reject) {
                // Use RequireJS require() to load the UMD build.
                // RequireJS handles AMD detection in the UMD wrapper.
                require([url], function(fabric) {
                    fabricLib = fabric;
                    resolve(fabricLib);
                }, function(err) {
                    reject(err);
                });
            });

            return loadPromise;
        },
    };
});
