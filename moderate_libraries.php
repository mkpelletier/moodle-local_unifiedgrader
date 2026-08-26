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
 * Admin tool to audit and repair teachers' comment libraries.
 *
 * Dispatches on the `action` query parameter: list (default), view, recode,
 * reassign, purgemaps, importlegacy.
 *
 * @package    local_unifiedgrader
 * @copyright  2026 South African Theological Seminary (mathieu@sats.ac.za)
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

require(__DIR__ . '/../../config.php');
require_once($CFG->libdir . '/adminlib.php');

use local_unifiedgrader\library_audit;

admin_externalpage_setup('local_unifiedgrader_moderatelibraries');

$context = context_system::instance();
require_capability('local/unifiedgrader:moderatelibraries', $context);

$action = optional_param('action', 'list', PARAM_ALPHA);
$filteruser = optional_param('filteruser', 0, PARAM_INT);
$filtercode = optional_param('filtercode', '', PARAM_TEXT);
$anomaliesonly = optional_param('anomaliesonly', 0, PARAM_BOOL);
$code = optional_param('code', '', PARAM_TEXT);
$owner = optional_param('owner', 0, PARAM_INT);

$baseurl = new moodle_url('/local/unifiedgrader/moderate_libraries.php');
$filterparams = [
    'filteruser' => $filteruser,
    'filtercode' => $filtercode,
    'anomaliesonly' => $anomaliesonly,
];
$listurl = new moodle_url($baseurl, $filterparams);

$PAGE->set_url($baseurl);
$PAGE->set_title(get_string('clibmod_pagename', 'local_unifiedgrader'));
$PAGE->set_heading(get_string('clibmod_pagename', 'local_unifiedgrader'));

/**
 * Log a repair so the change is recoverable from the admin logs.
 *
 * @param string $repairaction Short action key.
 * @param int $count Number of comments affected.
 * @param string $detail Free-text detail (target code, new owner, ...).
 */
function local_unifiedgrader_log_repair(string $repairaction, int $count, string $detail): void {
    \local_unifiedgrader\event\library_repaired::create([
        'context' => context_system::instance(),
        'other' => [
            'action' => $repairaction,
            'count' => $count,
            'detail' => $detail,
        ],
    ])->trigger();
}

// Repair actions. All are POST-or-sesskey guarded and redirect back to the list.
if ($action === 'recode') {
    require_sesskey();
    $commentids = optional_param_array('commentids', [], PARAM_INT);
    $newcode = trim(optional_param('newcode', '', PARAM_TEXT));
    $changed = library_audit::recode_comments($commentids, $newcode);
    local_unifiedgrader_log_repair('recode', $changed, $newcode);
    redirect(
        $listurl,
        get_string('clibmod_recoded', 'local_unifiedgrader', (object) [
            'count' => $changed,
            'code' => $newcode !== '' ? $newcode : get_string('clibmod_universal', 'local_unifiedgrader'),
        ]),
    );
}

if ($action === 'reassign') {
    require_sesskey();
    $commentids = optional_param_array('commentids', [], PARAM_INT);
    $newuserid = optional_param('newuserid', 0, PARAM_INT);
    $changed = library_audit::reassign_comments($commentids, $newuserid);
    local_unifiedgrader_log_repair('reassign', $changed, 'userid ' . $newuserid);
    redirect($listurl, get_string('clibmod_reassigned', 'local_unifiedgrader', $changed));
}

if ($action === 'purgemaps') {
    require_sesskey();
    $removed = library_audit::purge_orphan_maps();
    local_unifiedgrader_log_repair('purgemaps', $removed, 'orphaned tag mappings');
    redirect($listurl, get_string('clibmod_maps_purged', 'local_unifiedgrader', $removed));
}

if ($action === 'importlegacy') {
    require_sesskey();
    $imported = library_audit::import_legacy($filteruser);
    local_unifiedgrader_log_repair('importlegacy', $imported, 'userid ' . $filteruser);
    redirect($listurl, get_string('clibmod_legacy_imported', 'local_unifiedgrader', $imported));
}

echo $OUTPUT->header();

// Drill-down: the individual comments behind one owner + code bucket.
if ($action === 'view') {
    $comments = library_audit::get_comments_for($owner, $code);
    $ownername = $owner === 0
        ? get_string('clibmod_system_owner', 'local_unifiedgrader')
        : fullname($DB->get_record('user', ['id' => $owner], '*', IGNORE_MISSING) ?: (object) [
            'firstname' => get_string('clibmod_missing_owner', 'local_unifiedgrader', $owner),
            'lastname' => '',
        ]);

    echo $OUTPUT->heading(
        get_string('clibmod_bucket_heading', 'local_unifiedgrader', (object) [
            'owner' => s($ownername),
            'code' => $code !== '' ? s($code) : get_string('clibmod_universal', 'local_unifiedgrader'),
        ]),
        2,
    );
    echo html_writer::link($listurl, get_string('clibmod_back_to_list', 'local_unifiedgrader'), [
        'class' => 'd-inline-block mb-3',
    ]);

    if (empty($comments)) {
        echo html_writer::tag('p', get_string('clibmod_no_comments', 'local_unifiedgrader'), [
            'class' => 'text-muted',
        ]);
        echo $OUTPUT->footer();
        exit;
    }

    // Bulk repair form: tick comments, then either re-scope or reassign them.
    echo html_writer::start_tag('form', [
        'method' => 'post',
        'action' => $baseurl->out(false),
        'id' => 'clibmod-bulk',
    ]);
    echo html_writer::empty_tag('input', ['type' => 'hidden', 'name' => 'sesskey', 'value' => sesskey()]);
    foreach ($filterparams as $name => $value) {
        echo html_writer::empty_tag('input', [
            'type' => 'hidden',
            'name' => $name,
            'value' => $value,
        ]);
    }

    $table = new html_table();
    $table->head = [
        html_writer::checkbox('clibmod-selectall', 1, false, '', ['id' => 'clibmod-selectall']),
        get_string('clib_comment_content', 'local_unifiedgrader'),
        get_string('clib_tags', 'local_unifiedgrader'),
        get_string('clibmod_shared', 'local_unifiedgrader'),
        get_string('clibmod_created', 'local_unifiedgrader'),
    ];
    $table->attributes['class'] = 'generaltable';
    $table->data = [];

    foreach ($comments as $comment) {
        $tagpills = '';
        foreach ($comment['tags'] as $tagname) {
            $tagpills .= html_writer::span(format_string($tagname), 'badge bg-secondary me-1');
        }
        $table->data[] = [
            html_writer::checkbox('commentids[]', $comment['id'], false, '', [
                'class' => 'clibmod-check',
            ]),
            shorten_text(format_text($comment['content'], FORMAT_PLAIN), 300),
            $tagpills ?: html_writer::tag('span', '—', ['class' => 'text-muted']),
            $comment['shared']
                ? get_string('yes')
                : html_writer::tag('span', get_string('no'), ['class' => 'text-muted']),
            userdate($comment['timecreated'], get_string('strftimedatetimeshort')),
        ];
    }
    echo html_writer::table($table);

    // Target-code input, with every code the site can currently produce
    // offered as a suggestion so an admin doesn't have to guess the spelling.
    $datalist = '';
    foreach (library_audit::get_known_codes() as $entry) {
        $datalist .= html_writer::empty_tag('option', ['value' => $entry['code']]);
    }
    echo html_writer::tag('datalist', $datalist, ['id' => 'clibmod-known-codes']);

    echo html_writer::start_div('card p-3 mb-3');
    echo html_writer::tag('h4', get_string('clibmod_recode_heading', 'local_unifiedgrader'), ['class' => 'h5']);
    echo html_writer::tag('p', get_string('clibmod_recode_help', 'local_unifiedgrader'), [
        'class' => 'text-muted small',
    ]);
    echo html_writer::start_div('d-flex align-items-center gap-2 flex-wrap');
    echo html_writer::empty_tag('input', [
        'type' => 'text',
        'name' => 'newcode',
        'list' => 'clibmod-known-codes',
        'class' => 'form-control w-auto',
        'placeholder' => get_string('clibmod_newcode_placeholder', 'local_unifiedgrader'),
    ]);
    echo html_writer::tag('button', get_string('clibmod_recode_button', 'local_unifiedgrader'), [
        'type' => 'submit',
        'name' => 'action',
        'value' => 'recode',
        'class' => 'btn btn-primary',
    ]);
    echo html_writer::end_div();
    echo html_writer::end_div();

    echo html_writer::start_div('card p-3');
    echo html_writer::tag('h4', get_string('clibmod_reassign_heading', 'local_unifiedgrader'), ['class' => 'h5']);
    echo html_writer::tag('p', get_string('clibmod_reassign_help', 'local_unifiedgrader'), [
        'class' => 'text-muted small',
    ]);
    echo html_writer::start_div('d-flex align-items-center gap-2 flex-wrap');
    echo html_writer::empty_tag('input', [
        'type' => 'number',
        'name' => 'newuserid',
        'min' => 1,
        'class' => 'form-control w-auto',
        'placeholder' => get_string('clibmod_newowner_placeholder', 'local_unifiedgrader'),
    ]);
    echo html_writer::tag('button', get_string('clibmod_reassign_button', 'local_unifiedgrader'), [
        'type' => 'submit',
        'name' => 'action',
        'value' => 'reassign',
        'class' => 'btn btn-outline-danger',
    ]);
    echo html_writer::end_div();
    echo html_writer::end_div();

    echo html_writer::end_tag('form');

    $PAGE->requires->js_amd_inline("
        require([], function() {
            var all = document.getElementById('clibmod-selectall');
            if (!all) { return; }
            all.addEventListener('change', function() {
                document.querySelectorAll('.clibmod-check').forEach(function(box) {
                    box.checked = all.checked;
                });
            });
        });
    ");

    echo $OUTPUT->footer();
    exit;
}

// Default list view.
echo $OUTPUT->heading(get_string('clibmod_pagename', 'local_unifiedgrader'), 2);
echo html_writer::tag('p', get_string('clibmod_intro', 'local_unifiedgrader'), ['class' => 'text-muted']);

// Filters.
echo html_writer::start_tag('form', ['method' => 'get', 'action' => $baseurl->out(false), 'class' => 'mb-4']);
echo html_writer::start_div('d-flex align-items-end gap-2 flex-wrap');
echo html_writer::div(
    html_writer::label(get_string('clibmod_filter_user', 'local_unifiedgrader'), 'filteruser', true, [
        'class' => 'form-label small mb-1',
    ])
    . html_writer::empty_tag('input', [
        'type' => 'number',
        'id' => 'filteruser',
        'name' => 'filteruser',
        'min' => 0,
        'value' => $filteruser ?: '',
        'class' => 'form-control w-auto',
    ]),
);
echo html_writer::div(
    html_writer::label(get_string('clibmod_filter_code', 'local_unifiedgrader'), 'filtercode', true, [
        'class' => 'form-label small mb-1',
    ])
    . html_writer::empty_tag('input', [
        'type' => 'text',
        'id' => 'filtercode',
        'name' => 'filtercode',
        'value' => $filtercode,
        'class' => 'form-control w-auto',
    ]),
);
echo html_writer::div(
    html_writer::checkbox('anomaliesonly', 1, (bool) $anomaliesonly, ' ' . get_string(
        'clibmod_anomalies_only',
        'local_unifiedgrader',
    ), ['id' => 'anomaliesonly']),
    'form-check pb-2',
);
echo html_writer::tag('button', get_string('clibmod_apply_filters', 'local_unifiedgrader'), [
    'type' => 'submit',
    'class' => 'btn btn-secondary',
]);
echo html_writer::link($baseurl, get_string('clibmod_clear_filters', 'local_unifiedgrader'), [
    'class' => 'btn btn-link',
]);
echo html_writer::end_div();
echo html_writer::end_tag('form');

$inventory = library_audit::get_inventory($filteruser, $filtercode, (bool) $anomaliesonly);

// Anomaly summary — a count per flag across the whole filtered set, computed
// before any display truncation so the totals stay honest.
$flagcounts = array_fill_keys(library_audit::all_flags(), 0);
foreach ($inventory as $row) {
    foreach ($row['flags'] as $flag) {
        $flagcounts[$flag]++;
    }
}

// A site with many teachers produces one row per teacher per course code,
// which is more than a single page should render. Cap the table, and say so —
// a silently truncated audit reads as a clean bill of health.
$rowcap = 500;
$totalrows = count($inventory);
$truncated = $totalrows > $rowcap;
if ($truncated) {
    $inventory = array_slice($inventory, 0, $rowcap);
}
$activeflags = array_filter($flagcounts);

echo $OUTPUT->heading(get_string('clibmod_summary_heading', 'local_unifiedgrader'), 3);
if (empty($activeflags)) {
    echo $OUTPUT->notification(
        get_string('clibmod_no_anomalies', 'local_unifiedgrader'),
        \core\output\notification::NOTIFY_SUCCESS,
    );
} else {
    echo html_writer::start_div('d-flex gap-2 flex-wrap mb-3');
    foreach ($activeflags as $flag => $count) {
        echo html_writer::span(
            get_string('clibmod_flag_' . $flag, 'local_unifiedgrader') . ': ' . $count,
            'badge bg-warning text-dark p-2',
        );
    }
    echo html_writer::end_div();
}

// Inventory table.
echo $OUTPUT->heading(get_string('clibmod_inventory_heading', 'local_unifiedgrader'), 3, 'mt-4');

$table = new html_table();
$table->head = [
    get_string('clibmod_owner', 'local_unifiedgrader'),
    get_string('clibmod_coursecode', 'local_unifiedgrader'),
    get_string('clibmod_matching_courses', 'local_unifiedgrader'),
    get_string('clibmod_numcomments', 'local_unifiedgrader'),
    get_string('clibmod_lastmodified', 'local_unifiedgrader'),
    get_string('clibmod_flags', 'local_unifiedgrader'),
    get_string('actions'),
];
$table->attributes['class'] = 'generaltable';
$table->data = [];

foreach ($inventory as $row) {
    // Show the code with visible delimiters — trailing whitespace is one of
    // the commonest reasons a bucket splits in two, and it is invisible
    // without them.
    if ($row['isuniversal']) {
        $codecell = html_writer::span(
            get_string('clibmod_universal', 'local_unifiedgrader'),
            'badge bg-info text-dark',
        );
    } else {
        $codecell = html_writer::tag('code', '[' . s($row['coursecode']) . ']');
    }

    $coursecell = '';
    foreach ($row['courses'] as $course) {
        $coursecell .= html_writer::div(
            html_writer::link(
                new moodle_url('/course/view.php', ['id' => $course['id']]),
                s($course['shortname']),
            )
            . ($course['visible'] ? '' : ' ' . html_writer::span(
                get_string('clibmod_hidden_course', 'local_unifiedgrader'),
                'badge bg-secondary',
            )),
        );
    }
    if ($coursecell === '' && !$row['isuniversal']) {
        $coursecell = html_writer::span(
            get_string('clibmod_no_matching_course', 'local_unifiedgrader'),
            'text-danger',
        );
    }

    $flagcell = '';
    foreach ($row['flags'] as $flag) {
        $flagcell .= html_writer::span(
            get_string('clibmod_flag_' . $flag, 'local_unifiedgrader'),
            'badge bg-warning text-dark me-1 mb-1',
        );
    }

    $ownercell = s($row['ownername']);
    if ($row['userid'] > 0) {
        $ownercell = html_writer::link(
            new moodle_url('/user/profile.php', ['id' => $row['userid']]),
            $ownercell,
        );
    }
    $ownercell .= html_writer::tag('div', 'id ' . $row['userid'], ['class' => 'text-muted small']);
    if ($row['ownerdeleted']) {
        $ownercell .= html_writer::span(get_string('clibmod_owner_deleted', 'local_unifiedgrader'), 'badge bg-danger');
    } else if ($row['ownersuspended']) {
        $ownercell .= html_writer::span(
            get_string('clibmod_owner_suspended', 'local_unifiedgrader'),
            'badge bg-secondary',
        );
    }

    $viewurl = new moodle_url($baseurl, array_merge($filterparams, [
        'action' => 'view',
        'owner' => $row['userid'],
        'code' => $row['coursecode'],
    ]));

    $table->data[] = [
        $ownercell,
        $codecell,
        $coursecell,
        $row['numcomments'],
        userdate($row['lastmodified'], get_string('strftimedatetimeshort')),
        $flagcell ?: html_writer::tag('span', '—', ['class' => 'text-muted']),
        html_writer::link($viewurl, get_string('clibmod_inspect', 'local_unifiedgrader'), [
            'class' => 'btn btn-sm btn-outline-primary',
        ]),
    ];
}

if (empty($table->data)) {
    echo html_writer::tag('p', get_string('clibmod_nothing_found', 'local_unifiedgrader'), ['class' => 'text-muted']);
} else {
    if ($truncated) {
        echo $OUTPUT->notification(
            get_string('clibmod_truncated', 'local_unifiedgrader', (object) [
                'shown' => $rowcap,
                'total' => $totalrows,
            ]),
            \core\output\notification::NOTIFY_WARNING,
        );
    }
    echo html_writer::table($table);
}

// Orphaned tag mappings.
$orphans = library_audit::get_orphan_maps();
echo $OUTPUT->heading(get_string('clibmod_orphanmaps_heading', 'local_unifiedgrader'), 3, 'mt-4');
if (empty($orphans)) {
    echo html_writer::tag('p', get_string('clibmod_no_orphanmaps', 'local_unifiedgrader'), ['class' => 'text-muted']);
} else {
    echo html_writer::tag('p', get_string('clibmod_orphanmaps_found', 'local_unifiedgrader', count($orphans)));
    echo $OUTPUT->single_button(
        new moodle_url($baseurl, array_merge($filterparams, [
            'action' => 'purgemaps',
            'sesskey' => sesskey(),
        ])),
        get_string('clibmod_purge_maps', 'local_unifiedgrader'),
        'get',
    );
}

// Unmigrated pre-v2 rows.
$legacy = library_audit::get_unmigrated_legacy($filteruser);
echo $OUTPUT->heading(get_string('clibmod_legacy_heading', 'local_unifiedgrader'), 3, 'mt-4');
if (empty($legacy)) {
    echo html_writer::tag('p', get_string('clibmod_no_legacy', 'local_unifiedgrader'), ['class' => 'text-muted']);
} else {
    echo html_writer::tag('p', get_string('clibmod_legacy_found', 'local_unifiedgrader', count($legacy)));

    $legacytable = new html_table();
    $legacytable->head = [
        get_string('clibmod_owner', 'local_unifiedgrader'),
        get_string('clibmod_legacy_course', 'local_unifiedgrader'),
        get_string('clibmod_legacy_wouldbecode', 'local_unifiedgrader'),
        get_string('clib_comment_content', 'local_unifiedgrader'),
        get_string('clibmod_created', 'local_unifiedgrader'),
    ];
    $legacytable->attributes['class'] = 'generaltable';
    $legacytable->data = [];
    foreach ($legacy as $row) {
        $coursecell = $row['coursemissing']
            ? html_writer::span(get_string('clibmod_legacy_course_gone', 'local_unifiedgrader'), 'text-danger')
            : s($row['shortname']);
        $legacytable->data[] = [
            'id ' . $row['userid'],
            $coursecell,
            $row['wouldbecode'] !== ''
                ? html_writer::tag('code', s($row['wouldbecode']))
                : html_writer::span(get_string('clibmod_universal', 'local_unifiedgrader'), 'badge bg-info text-dark'),
            shorten_text(format_text($row['content'], FORMAT_PLAIN), 200),
            userdate($row['timecreated'], get_string('strftimedatetimeshort')),
        ];
    }
    echo html_writer::table($legacytable);

    echo html_writer::tag('p', get_string('clibmod_legacy_import_help', 'local_unifiedgrader'), [
        'class' => 'text-muted small',
    ]);
    echo $OUTPUT->single_button(
        new moodle_url($baseurl, array_merge($filterparams, [
            'action' => 'importlegacy',
            'sesskey' => sesskey(),
        ])),
        get_string('clibmod_import_legacy', 'local_unifiedgrader'),
        'get',
    );
}

echo $OUTPUT->footer();
