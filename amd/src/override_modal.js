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
 * Override modal — opens an iframe with Moodle's native override form
 * and listens for postMessage events to detect save/cancel.
 *
 * @module     local_unifiedgrader/override_modal
 * @copyright  2026 South African Theological Seminary
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import Modal from 'core/modal';
import {getString} from 'core/str';

/**
 * Open the override modal with an iframe containing the override form.
 *
 * @param {number} cmid Course module ID.
 * @param {number} userid Student user ID.
 * @param {number} overrideid Existing override ID (0 for new).
 * @return {Promise<boolean>} Resolves to true if override was saved, false if cancelled.
 */
export const openOverrideModal = async(cmid, userid, overrideid) => {
    const title = await getString(
        overrideid ? 'action_edit_override' : 'action_add_override',
        'local_unifiedgrader',
    );

    const iframeUrl = M.cfg.wwwroot + '/local/unifiedgrader/override.php'
        + '?cmid=' + cmid + '&userid=' + userid + '&overrideid=' + (overrideid || 0);

    const modal = await Modal.create({
        title: title,
        body: '<iframe src="' + iframeUrl + '" '
            + 'style="width:100%;height:500px;border:none;" '
            + 'id="unifiedgrader-override-iframe"></iframe>',
        large: true,
        removeOnClose: true,
    });

    return new Promise((resolve) => {
        let saved = false;

        const messageHandler = (event) => {
            if (event.origin !== window.location.origin) {
                return;
            }
            if (!event.data || typeof event.data !== 'object') {
                return;
            }
            if (event.data.type === 'override_saved') {
                saved = true;
                modal.destroy();
            } else if (event.data.type === 'override_cancelled') {
                modal.destroy();
            }
        };

        window.addEventListener('message', messageHandler);

        // Clean up listener when modal is destroyed.
        modal.getRoot().on('modal:hidden', () => {
            window.removeEventListener('message', messageHandler);
            resolve(saved);
        });

        modal.show();
    });
};
