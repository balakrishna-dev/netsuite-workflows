<?php
error_reporting(0);

$pass_percentage = isset($pass_percentage) ? $pass_percentage : 35;

/* Student FAILS if ANY single subject is below pass % OR is Absent (AB) */
$fail_if_any_subject_below = true;

/* Marks entered as this value mean "Not Applicable" (NA):
   the subject is skipped - not added to Total, not added to Max Marks,
   and does not affect Pass/Fail. */
$na_mark_value = 1;

/* Gender column: change the field name here if your query uses a different one */
function stu_gender_label($stu) {
	$g = '';
	foreach (array('stu_gender', 'gender', 'stu_sex', 'sex') as $f) {
		if (isset($stu[$f]) && trim($stu[$f]) !== '') { $g = strtolower(trim($stu[$f])); break; }
	}
	if (in_array($g, array('m', 'male', 'boy', '1'))) return 'Male';
	if (in_array($g, array('f', 'female', 'girl', '2'))) return 'Female';
	return '-';
}

/* ---- One page, three views (All / Male / Female); the buttons switch between them ---- */
$all_results = $exam_results;
$first       = $exam_results[0][0];   // header info (class, section, exam)
$exam_date   = $first['exam_details_date'];

?>
<html>
<head>
<title><?php echo $this->session->userdata('inst_name');?> - <?php echo $first['exam_name'];?> Result</title>
<link rel="shortcut icon" href="<?php echo base_url();?>images/<?php echo $this->session->userdata('inst_logo');?>" />
<style>
body{ margin:0; padding:15px; font-family: Calibri, Arial, sans-serif; font-size:14px; }
.sheet{ width:95%; margin:0 auto; }
.head{ display:flex; align-items:center; border:1px solid #000; padding:8px; }
.head img{ height:80px; width:80px; margin-right:15px; }
.head .title{ flex:1; text-align:center; }
.head .title h2{ margin:0; font-family: Georgia, serif; }
.head .title h3{ margin:4px 0 0; }
.meta{ border:1px solid #000; border-top:none; padding:6px; display:flex; justify-content:space-between; }
table.result{ width:100%; border-collapse:collapse; margin-top:10px; }
table.result th, table.result td{ border:1px solid #000; padding:5px 6px; text-align:center; }
table.result th{ background:#d9e1f2; }
table.result td.name{ text-align:left; }
.low{ color:#c00000; font-weight:bold; }
.ab{ color:#c00000; font-weight:bold; }
.na{ color:#7f7f7f; font-weight:bold; }
.pass{ background:#c6efce; color:#006100; font-weight:bold; }
.fail{ background:#ffc7ce; color:#9c0006; font-weight:bold; }
.summary{ margin-top:10px; font-weight:bold; }
.note{ margin-top:4px; font-size:12px; }
.sec-title{ margin-top:20px; font-weight:bold; font-size:15px; text-decoration:underline; }
.signs{ width:100%; margin-top:50px; }
.signs td{ width:33%; }
.btn-print{ margin:10px 0; padding:6px 16px; cursor:pointer; }
.filters{ display:inline-block; margin-left:10px; }
.filters button{ margin-right:6px; padding:6px 14px; border:1px solid #000; background:#fff; cursor:pointer; }
.filters button.active{ background:#d9e1f2; font-weight:bold; }
.gview{ display:none; }
.gview.show{ display:block; }
@media print{
	.btn-print, .filters{ display:none; }
	body{ padding:0; }
	.sheet{ width:100%; }
	th{ -webkit-print-color-adjust:exact; print-color-adjust:exact; }
	.pass, .fail{ -webkit-print-color-adjust:exact; print-color-adjust:exact; }
}
</style>
</head>
<body>
<div class="sheet">

	<button class="btn-print" onclick="window.print()">Print</button>
	<div class="filters">
		<button type="button" class="active" data-view="all" onclick="showView('all', this)">All Students</button>
		<button type="button" data-view="male" onclick="showView('male', this)">Male Only</button>
		<button type="button" data-view="female" onclick="showView('female', this)">Female Only</button>
	</div>

<?php
foreach (array('' => 'all', 'Male' => 'male', 'Female' => 'female') as $gender_filter => $view_id)
{
	/* ---- Students for this view ---- */
	$exam_results = array();
	foreach ($all_results as $stu_rows) {
		if ($gender_filter === '' || stu_gender_label($stu_rows[0]) === $gender_filter) { $exam_results[] = $stu_rows; }
	}

	/* ---- Build the subject column list (union across all students, keeps order) ---- */
	$subjects = array();   // subject_name => max marks

	foreach ($exam_results as $stu_rows) {
		foreach ($stu_rows as $row) {
			$name = $row['subject_name'];
			if (!isset($subjects[$name])) {
				$subjects[$name] = (float)$row['total_marks'];
			}
		}
	}
	$grand_max = array_sum($subjects);

	/* ---- Subject-wise statistics holder ---- */
	$sub_stats = array();
	foreach ($subjects as $sub_name => $sub_max) {
		$sub_stats[$sub_name] = array(
			'total'    => 0,     // students who have this subject (excluding NA)
			'appeared' => 0,
			'absent'   => 0,
			'na'       => 0,     // marked Not Applicable
			'pass'     => 0,
			'fail'     => 0,     // failed among appeared (below pass %)
			'sum'      => 0,
			'high'     => null,
			'low'      => null,
		);
	}

	/* ---- Sort students: Top marks -> Low marks (NA subjects excluded) ---- */
	$score = array();
	foreach ($exam_results as $k => $stu_rows) {
		$t  = 0;
		$mx = 0;
		foreach ($stu_rows as $r) {
			$m = round((float)$r['total_obtained']);
			if ($m == $na_mark_value) { continue; }   // NA -> skip
			$t  += $m;
			$mx += (float)$r['total_marks'];
		}
		$pct = ($mx > 0) ? ($t / $mx) * 100 : 0;
		$score[$k] = ($pct * 100000) + $t;
	}
	arsort($score);

	$sorted_results = array();
	foreach ($score as $k => $v) {
		$sorted_results[] = $exam_results[$k];
	}

	$pass_count = 0;
	$fail_count = 0;
	$gender_stats = array(
		'Male'   => array('total' => 0, 'pass' => 0, 'fail' => 0),
		'Female' => array('total' => 0, 'pass' => 0, 'fail' => 0),
	);
?>
<div class="gview<?php echo $view_id === 'all' ? ' show' : '';?>" id="view-<?php echo $view_id;?>">

	<div class="head">
		<img src="<?php echo base_url();?>images/<?php echo $this->session->userdata('client');?>/<?php echo $this->session->userdata('inst_logo');?>" alt="">
		<div class="title">
			<h2><?php echo $this->session->userdata('inst_name');?></h2>
			<h3><?php echo $first['exam_name'];?> EXAM RESULT (<?php echo date('M-Y', strtotime($exam_date));?>)<?php echo $gender_filter !== '' ? ' - '.strtoupper($gender_filter).' STUDENTS' : '';?></h3>
		</div>
	</div>
	<div class="meta">
		<span>Class: <b><?php echo $first['class_name'];?></b></span>
		<span>Section: <b><?php echo $first['section_name'];?></b></span>
		<span>Pass Mark: <b><?php echo $pass_percentage;?>% in each subject</b></span>
	</div>

	<table class="result">
		<thead>
			<tr>
				<th>S.NO</th>
				<th>Stud Id</th>
				<th>Student Name</th>
				<th>Gender</th>
				<?php foreach ($subjects as $sub_name => $sub_max) { ?>
					<th><?php echo $sub_name;?> (<?php echo round((float)$sub_max);?>)</th>
				<?php } ?>
				<th>Total Obtained</th>
				<th>Max Marks</th>
				<th>Percentage</th>
				<th>Status</th>
			</tr>
		</thead>
		<tbody>
		<?php
		$sno = 1;

		foreach ($sorted_results as $stu_rows)
		{
			$stu    = $stu_rows[0];
			$gender = stu_gender_label($stu);

			$marks_by_sub = array();
			foreach ($stu_rows as $row) {
				$marks_by_sub[$row['subject_name']] = (float)$row['total_obtained'];
			}

			$total_obtained   = 0;
			$total_max        = 0;
			$any_subject_fail = false;
		?>
			<tr>
				<td><?php echo $sno++;?></td>
				<td><?php echo $stu['stu_id'];?></td>
				<td class="name"><?php echo trim($stu['stu_first_name'].' '.$stu['stu_last_name']);?></td>
				<td><?php echo $gender;?></td>
				<?php foreach ($subjects as $sub_name => $sub_max) {
					if (isset($marks_by_sub[$sub_name])) {
						$m = round((float)$marks_by_sub[$sub_name]);

						if ($m == $na_mark_value) {
							/* NOT APPLICABLE -> skip: no marks, no max marks, no pass/fail */
							$sub_stats[$sub_name]['na']++;
							echo '<td class="na">NA</td>';
							continue;
						}

						$total_obtained += $m;
						$total_max      += $sub_max;
						$sub_stats[$sub_name]['total']++;

						if ($m == 0) {
							/* ABSENT -> student fails */
							$any_subject_fail = true;
							$sub_stats[$sub_name]['absent']++;
							echo '<td class="ab">AB (F)</td>';
						} else {
							$sub_pct = $sub_max > 0 ? ($m / $sub_max) * 100 : 0;
							$is_low  = $sub_pct < $pass_percentage;

							$sub_stats[$sub_name]['appeared']++;
							$sub_stats[$sub_name]['sum'] += $m;
							if ($sub_stats[$sub_name]['high'] === null || $m > $sub_stats[$sub_name]['high']) $sub_stats[$sub_name]['high'] = $m;
							if ($sub_stats[$sub_name]['low']  === null || $m < $sub_stats[$sub_name]['low'])  $sub_stats[$sub_name]['low']  = $m;

							if ($is_low) {
								$any_subject_fail = true;
								$sub_stats[$sub_name]['fail']++;
							} else {
								$sub_stats[$sub_name]['pass']++;
							}
							echo '<td'.($is_low ? ' class="low"' : '').'>'.$m.($is_low ? ' (F)' : ' (P)').'</td>';
						}
					} else {
						echo '<td>-</td>';   // subject not taken / no marks entered
					}
				} ?>
				<?php
					/* Percentage is calculated only on the subjects that are NOT NA */
					$percentage = $total_max > 0 ? ($total_obtained / $total_max) * 100 : 0;
					$is_pass    = $total_max > 0 && $percentage >= $pass_percentage;
					if ($fail_if_any_subject_below && $any_subject_fail) { $is_pass = false; }
					if ($is_pass) { $pass_count++; } else { $fail_count++; }
					if (isset($gender_stats[$gender])) {
						$gender_stats[$gender]['total']++;
						$gender_stats[$gender][$is_pass ? 'pass' : 'fail']++;
					}
				?>
				<td><b><?php echo $total_obtained;?></b></td>
				<td><?php echo round((float)$total_max);?></td>
				<td><?php echo $is_pass ? number_format($percentage, 2).'%' : 'NA';?></td>
				<td class="<?php echo $is_pass ? 'pass' : 'fail';?>"><?php echo $is_pass ? 'PASS' : 'FAIL';?></td>
			</tr>
		<?php } ?>
		</tbody>
	</table>

	<?php $total_students = $pass_count + $fail_count; ?>
	<div class="summary">
		Total Students: <?php echo $total_students;?> &emsp;|&emsp;
		Passed: <?php echo $pass_count;?> &emsp;|&emsp;
		Failed: <?php echo $fail_count;?> &emsp;|&emsp;
		Pass %: <?php echo $total_students > 0 ? number_format(($pass_count / $total_students) * 100, 2) : '0.00';?>%
	</div>
	<div class="summary">
		<?php foreach ($gender_stats as $g_name => $gs) { if ($gender_filter !== '' && $g_name !== $gender_filter) continue; ?>
			<?php echo $g_name;?>: <?php echo $gs['total'];?>
			(Passed: <?php echo $gs['pass'];?>, Failed: <?php echo $gs['fail'];?>,
			Pass %: <?php echo $gs['total'] > 0 ? number_format(($gs['pass'] / $gs['total']) * 100, 2) : '0.00';?>%) &emsp;
		<?php } ?>
	</div>
	<div class="note">NA = Not Applicable (subject excluded from Total, Max Marks and Percentage) &emsp; AB = Absent</div>

	<!-- ================= SUBJECT-WISE STATISTICS ================= -->
	<div class="sec-title">Subject-wise Statistics</div>
	<table class="result">
		<thead>
			<tr>
				<th>S.NO</th>
				<th>Subject</th>
				<th>Max Marks</th>
				<th>Total Students</th>
				<th>Appeared</th>
				<th>Absent (AB)</th>
				<th>Not Applicable (NA)</th>
				<th>Passed</th>
				<th>Failed</th>
				<th>Pass % (of Appeared)</th>
				<th>Highest</th>
				<th>Lowest</th>
				<th>Average</th>
			</tr>
		</thead>
		<tbody>
		<?php
		$s = 1;
		foreach ($sub_stats as $sub_name => $st) {
			$sub_pass_pct = $st['appeared'] > 0 ? ($st['pass'] / $st['appeared']) * 100 : 0;
			$sub_avg      = $st['appeared'] > 0 ? $st['sum'] / $st['appeared'] : 0;
		?>
			<tr>
				<td><?php echo $s++;?></td>
				<td class="name"><?php echo $sub_name;?></td>
				<td><?php echo round((float)$subjects[$sub_name]);?></td>
				<td><?php echo $st['total'];?></td>
				<td><?php echo $st['appeared'];?></td>
				<td<?php echo $st['absent'] > 0 ? ' class="ab"' : '';?>><?php echo $st['absent'];?></td>
				<td<?php echo $st['na'] > 0 ? ' class="na"' : '';?>><?php echo $st['na'];?></td>
				<td><?php echo $st['pass'];?></td>
				<td<?php echo $st['fail'] > 0 ? ' class="low"' : '';?>><?php echo $st['fail'];?></td>
				<td><?php echo number_format($sub_pass_pct, 2);?>%</td>
				<td><?php echo $st['high'] === null ? '-' : $st['high'];?></td>
				<td><?php echo $st['low']  === null ? '-' : $st['low'];?></td>
				<td><?php echo number_format($sub_avg, 2);?></td>
			</tr>
		<?php } ?>
		</tbody>
	</table>

	<table class="signs">
		<tr>
			<td align="left">Class Teacher Sign.</td>
			<td align="center">HOD Sign.</td>
			<td align="right">Principal's Sign.</td>
		</tr>
	</table>
</div>
<?php } /* end foreach view */ ?>
</div>

<script>
function showView(id, btn) {
	var views = document.querySelectorAll('.gview');
	for (var i = 0; i < views.length; i++) { views[i].className = 'gview'; }
	document.getElementById('view-' + id).className = 'gview show';
	var btns = document.querySelectorAll('.filters button');
	for (var j = 0; j < btns.length; j++) { btns[j].className = ''; }
	btn.className = 'active';
}
</script>
</body>
</html>
