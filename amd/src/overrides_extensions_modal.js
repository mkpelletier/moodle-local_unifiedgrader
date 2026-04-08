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
 * Overrides & Extensions modal — opens an iframe with the unified
 * overrides/extensions form and listens for postMessage events.
 *
 * @module     local_unifiedgrader/overrides_extensions_modal
 * @copyright  2026 South African Theological Seminary
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import Modal from 'core/modal';
import Notification from 'core/notification';
import {getString} from 'core/str';

/**
 * Open the unified overrides & extensions modal.
 *
 * @param {number} cmid Course module ID.
 * @param {number} userid Student user ID.
 * @return {Promise<boolean>} Resolves to true if saved, false if cancelled.
 */
export const openOverridesExtensionsModal = async(cmid, userid) => {
    const title = await getString('overrides_extensions', 'local_unifiedgrader');

    const iframeUrl = M.cfg.wwwroot + '/local/unifiedgrader/overrides_extensions.php'
        + '?cmid=' + cmid + '&userid=' + userid;

    const modal = await Modal.create({
        title: title,
        body: '<iframe src="' + iframeUrl + '" '
            + 'style="width:100%;height:500px;border:none;" '
            + 'id="unifiedgrader-overrides-extensions-iframe"></iframe>',
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
            if (event.data.type === 'overrides_saved') {
                saved = true;
                modal.destroy();
            } else if (event.data.type === 'overrides_saved_ask_recalc') {
                saved = true;
                modal.destroy();
                // After the modal closes, ask whether to recalculate the penalty.
                _askRecalculatePenalty(event.data.cmid, event.data.userid);
            } else if (event.data.type === 'overrides_cancelled') {
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

/**
 * Show a confirmation dialog asking whether to recalculate the late penalty
 * after an extension was granted on a graded assignment.
 *
 * @param {number} cmid Course module ID.
 * @param {number} userid Student user ID.
 */
const _askRecalculatePenalty = async(cmid, userid) => {
    const message = await getString('recalculate_penalty_confirm', 'local_unifiedgrader');
    const title = await getString('recalculatepenalty', 'local_unifiedgrader');

    Notification.confirm(
        title,
        message,
        await getString('yes'),
        await getString('no'),
        async() => {
            // Teacher chose Yes — call the recalculation endpoint.
            try {
                const url = M.cfg.wwwroot + '/local/unifiedgrader/recalculate_penalty.php'
                    + '?cmid=' + cmid + '&userid=' + userid + '&sesskey=' + M.cfg.sesskey;
                const resp = await fetch(url, {method: 'POST'});
                if (resp.ok) {
                    // Trigger a page-level reload of the current student's data
                    // so the updated penalty is reflected in the grading interface.
                    document.dispatchEvent(new CustomEvent(
                        'unifiedgrader:penaltyrecalculated',
                        {detail: {cmid, userid}},
                    ));
                }
            } catch (err) {
                window.console.warn('[overrides_modal] Penalty recalculation failed:', err);
            }
        },
    );
};
