/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @description Escalates workflow approvals that breached their SLA.
 *
 * getInputData : pending transactions older than their SLA (SuiteQL)
 * map          : group overdue records by current approver
 * reduce       : one digest email per approver + reassign to delegate
 * summarize    : audit log and error report
 *
 * Author: Balakrishna Undela
 */
define(['N/query', 'N/record', 'N/email', 'N/runtime', 'N/log'], (query, record, email, runtime, log) => {

  const SLA_HOURS = {
    salesorder: 24,
    vendorbill: 48,
    purchaserequisition: 24,
    journalentry: 12,
    expensereport: 72
  };

  const getInputData = () => ({
    type: 'suiteql',
    query:
      'SELECT t.id, t.type, t.tranid, t.custbody_bu_next_approver AS approver, ' +
      '       ROUND((SYSDATE - t.lastmodifieddate) * 24, 1) AS hours_pending ' +
      'FROM transaction t ' +
      "WHERE t.approvalstatus = 1 AND t.custbody_bu_next_approver IS NOT NULL"
  });

  const map = (ctx) => {
    const [id, type, tranid, approver, hours] = JSON.parse(ctx.value).values;
    const sla = SLA_HOURS[String(type).toLowerCase()] || 24;
    if (Number(hours) < sla) return;
    ctx.write({ key: String(approver), value: { id, type, tranid, hours, sla } });
  };

  const reduce = (ctx) => {
    const approverId = ctx.key;
    const items = ctx.values.map(JSON.parse);

    const [delegate] = query.runSuiteQL({
      query: 'SELECT custentity_bu_delegate AS delegate FROM employee WHERE id = ?',
      params: [approverId]
    }).asMappedResults();

    items.forEach((it) => {
      if (!delegate || !delegate.delegate) return;
      record.submitFields({
        type: it.type,
        id: it.id,
        values: { custbody_bu_next_approver: delegate.delegate, custbody_bu_escalated: true },
        options: { ignoreMandatoryFields: true }
      });
    });

    const rows = items
      .map((it) => '<tr><td>' + it.tranid + '</td><td>' + it.type + '</td><td>' + it.hours + 'h / ' + it.sla + 'h</td></tr>')
      .join('');

    email.send({
      author: Number(runtime.getCurrentScript().getParameter({ name: 'custscript_bu_sender' })),
      recipients: [Number(approverId)],
      subject: items.length + ' approval(s) breached SLA',
      body: '<table><tr><th>Document</th><th>Type</th><th>Pending / SLA</th></tr>' + rows + '</table>'
    });

    ctx.write({ key: approverId, value: items.length });
  };

  const summarize = (summary) => {
    let escalated = 0;
    summary.output.iterator().each((key, value) => { escalated += Number(value); return true; });
    log.audit('Escalation run complete', { escalated, seconds: summary.seconds, usage: summary.usage });

    summary.mapSummary.errors.iterator().each((key, err) => { log.error('Map error ' + key, err); return true; });
    summary.reduceSummary.errors.iterator().each((key, err) => { log.error('Reduce error ' + key, err); return true; });
  };

  return { getInputData, map, reduce, summarize };
});
