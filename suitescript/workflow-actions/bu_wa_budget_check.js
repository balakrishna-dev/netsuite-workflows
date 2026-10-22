/**
 * @NApiVersion 2.1
 * @NScriptType WorkflowActionScript
 * @description Budget vs. actuals check for requisitions.
 */
define(['N/query'], (query) => {

  const remainingBudget = (dept, period) => {
    const [row] = query.runSuiteQL({
      query: 'SELECT b.amount - NVL(a.spent, 0) AS remaining ' +
             'FROM customrecord_bu_dept_budget b ' +
             'LEFT JOIN (SELECT department, SUM(amount) spent FROM transactionline ' +
             '  WHERE postingperiod = ? GROUP BY department) a ON a.department = b.custrecord_dept ' +
             'WHERE b.custrecord_dept = ? AND b.custrecord_period = ?',
      params: [period, dept, period]
    }).asMappedResults();
    return row ? Number(row.remaining) : 0;
  };

  const onAction = ({ newRecord: req }) => {
    const remaining = remainingBudget(req.getValue('department'), req.getValue('postingperiod'));
    return Number(req.getValue('estimatedtotal')) <= remaining ? 'OK' : 'OVER';
  };

  return { onAction };
});
