/**
 * NetSuite Workflow Library
 * --------------------------------------------------------------
 * Each workflow models a real-world NetSuite SuiteFlow process:
 * states, transitions, conditions, actions and the SuiteScript
 * that backs the custom logic.
 *
 * Grid units: x = column, y = row. The renderer converts them
 * into canvas coordinates, so layouts stay readable and editable.
 *
 * Author: Balakrishna Undela
 */
(function () {
  'use strict';

  const WORKFLOWS = [
    /* ────────────────────────────────────────────────────────── */
    {
      id: 'sales-order-approval',
      name: 'Sales Order Approval',
      category: 'Order to Cash',
      record: 'Sales Order',
      version: '3.2',
      color: '#7c5cff',
      summary:
        'Tiered, amount-based approval routing with an automatic credit check, ' +
        'escalation to Director / CFO and release to fulfillment.',
      inputs: [
        { key: 'amount', label: 'Order amount', type: 'range', min: 500, max: 120000, step: 500, value: 18500, format: 'currency' },
        { key: 'creditOk', label: 'Within credit limit', type: 'toggle', value: true },
        { key: 'decision', label: 'Approver decision', type: 'select', value: 'approve', options: [['approve', 'Approve'], ['reject', 'Reject']] }
      ],
      nodes: [
        { id: 'start', type: 'start', label: 'Sales Order Created', sub: 'Trigger · On Create', x: 0, y: 1, sla: 0,
          description: 'Workflow initiates when a sales rep saves a new Sales Order in the UI, through CSV import or via REST web services.',
          trigger: 'Before Record Submit · Event: Create',
          actions: [['Set Field Value', 'Order Status → Pending Approval'], ['Set Field Value', 'custbody_bu_wf_stage → "Submitted"']] },
        { id: 'validate', type: 'action', label: 'Validate Order', sub: 'Custom action script', x: 1, y: 1, sla: 0.1,
          description: 'Workflow Action Script validates margin, discount limits and mandatory fields before the order enters the approval queue.',
          trigger: 'Entry · After Record Submit',
          actions: [['Custom Action', 'customscript_bu_wa_validate_order'], ['Set Field Value', 'custbody_bu_margin_pct (calculated)']],
          script: 'validate' },
        { id: 'credit', type: 'decision', label: 'Credit Check', sub: 'Balance + order ≤ limit?', x: 2, y: 1, sla: 0.05,
          description: 'Compares the customer open balance plus this order total against the credit limit defined on the customer record.',
          trigger: 'Condition · Formula (Numeric)',
          actions: [['Formula', '{entity.balance} + {total} <= {entity.creditlimit}']] },
        { id: 'hold', type: 'state', label: 'Credit Hold', sub: 'AR review queue', x: 2, y: 2.35, sla: 6,
          description: 'Order is placed on hold and the Accounts Receivable team is notified to review the customer account.',
          trigger: 'Entry',
          actions: [['Send Email', 'AR Team · "Credit hold: {tranid}"'], ['Set Field Value', 'custbody_bu_credit_hold → T'], ['Create Record', 'Task · Review customer credit']] },
        { id: 'tier', type: 'decision', label: 'Approval Tier', sub: 'Route by order amount', x: 3, y: 1, sla: 0.05,
          description: 'Routes the order to the right approver based on configurable thresholds stored in a custom record (no hard-coding).',
          trigger: 'Condition · Saved Search Lookup',
          actions: [['Lookup', 'customrecord_bu_approval_matrix'], ['Branch', '< $10K · $10K–$50K · > $50K']] },
        { id: 'mgr', type: 'state', label: 'Sales Manager', sub: 'Orders < $10,000', x: 4, y: 0, sla: 2,
          description: 'Sales Manager of the rep\'s subsidiary approves. Reminder sent every 4 hours via scheduled transition.',
          trigger: 'Entry · Approve / Reject buttons',
          actions: [['Add Button', 'Approve'], ['Add Button', 'Reject'], ['Send Email', 'Supervisor of {salesrep}']] },
        { id: 'dir', type: 'state', label: 'Sales Director', sub: '$10,000 – $50,000', x: 4, y: 1, sla: 4,
          description: 'Director approval with automatic escalation to the delegate approver after 24 hours of inactivity.',
          trigger: 'Entry · Approve / Reject buttons',
          actions: [['Add Button', 'Approve'], ['Add Button', 'Reject'], ['Scheduled Transition', 'Escalate after 24h']] },
        { id: 'cfo', type: 'state', label: 'CFO Approval', sub: 'Orders > $50,000', x: 4, y: 2, sla: 8,
          description: 'High-value orders require CFO approval. Field-level locking prevents edits to pricing while pending.',
          trigger: 'Entry · Approve / Reject buttons',
          actions: [['Lock Record', 'Item sublist & pricing'], ['Add Button', 'Approve'], ['Add Button', 'Reject']] },
        { id: 'approved', type: 'action', label: 'Approved', sub: 'Stamp approver & date', x: 5, y: 1, sla: 0.1,
          description: 'Stamps approver, timestamp and approval tier for the audit trail, then sets the order to Pending Fulfillment.',
          trigger: 'Entry',
          actions: [['Set Field Value', 'Order Status → Pending Fulfillment'], ['Set Field Value', 'custbody_bu_approved_by → {currentuser}'], ['Send Email', 'Sales rep · Approved']] },
        { id: 'rejected', type: 'reject', label: 'Rejected', sub: 'Return to sales rep', x: 5, y: 2.35, sla: 0.1,
          description: 'Order is closed with a rejection reason captured in a mandatory field and the rep is notified.',
          trigger: 'Entry',
          actions: [['Set Field Value', 'Order Status → Closed'], ['Send Email', 'Sales rep · Rejected with reason']] },
        { id: 'end', type: 'end', label: 'Released', sub: 'To warehouse fulfillment', x: 6, y: 1, sla: 0,
          description: 'Workflow completes. The order is visible on the Fulfillment queue of the assigned location.',
          trigger: 'Exit', actions: [['Complete', 'Workflow instance finished']] }
      ],
      edges: [
        { from: 'start', to: 'validate' },
        { from: 'validate', to: 'credit' },
        { from: 'credit', to: 'tier', label: 'Pass', when: (s) => s.creditOk },
        { from: 'credit', to: 'hold', label: 'Over limit', when: (s) => !s.creditOk },
        { from: 'hold', to: 'tier', label: 'AR released' },
        { from: 'tier', to: 'mgr', label: '< 10K', when: (s) => s.amount < 10000 },
        { from: 'tier', to: 'dir', label: '10K–50K', when: (s) => s.amount >= 10000 && s.amount <= 50000 },
        { from: 'tier', to: 'cfo', label: '> 50K', when: (s) => s.amount > 50000 },
        { from: 'mgr', to: 'approved', when: (s) => s.decision === 'approve' },
        { from: 'dir', to: 'approved', when: (s) => s.decision === 'approve' },
        { from: 'cfo', to: 'approved', when: (s) => s.decision === 'approve' },
        { from: 'mgr', to: 'rejected', when: (s) => s.decision === 'reject' },
        { from: 'dir', to: 'rejected', label: 'Reject', when: (s) => s.decision === 'reject' },
        { from: 'cfo', to: 'rejected', when: (s) => s.decision === 'reject' },
        { from: 'approved', to: 'end' }
      ],
      scripts: {
        validate: {
          file: 'bu_wa_validate_order.js',
          type: 'Workflow Action Script',
          code: [
            '/**',
            ' * @NApiVersion 2.1',
            ' * @NScriptType WorkflowActionScript',
            ' * @description Validates margin & discount rules before approval.',
            ' */',
            "define(['N/runtime', 'N/search', 'N/log'], (runtime, search, log) => {",
            '',
            '  const MIN_MARGIN = 0.18;',
            '',
            '  const onAction = (ctx) => {',
            '    const so = ctx.newRecord;',
            "    const lines = so.getLineCount({ sublistId: 'item' });",
            '    let revenue = 0, cost = 0;',
            '',
            '    for (let i = 0; i < lines; i++) {',
            "      revenue += Number(so.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: i }));",
            "      cost    += Number(so.getSublistValue({ sublistId: 'item', fieldId: 'costestimate', line: i }));",
            '    }',
            '',
            '    const margin = revenue ? (revenue - cost) / revenue : 0;',
            "    so.setValue({ fieldId: 'custbody_bu_margin_pct', value: margin * 100 });",
            '',
            '    if (margin < MIN_MARGIN) {',
            "      log.audit('Low margin order', { id: so.id, margin });",
            "      return 'LOW_MARGIN';   // drives the next transition",
            '    }',
            "    return 'OK';",
            '  };',
            '',
            '  return { onAction };',
            '});'
          ].join('\n')
        }
      }
    },

    /* ────────────────────────────────────────────────────────── */
    {
      id: 'vendor-bill-3way-match',
      name: 'Vendor Bill 3-Way Match',
      category: 'Procure to Pay',
      record: 'Vendor Bill',
      version: '2.4',
      color: '#22d3ee',
      summary:
        'Automated PO ↔ Item Receipt ↔ Vendor Bill matching with tolerance rules, ' +
        'an AP exception queue and scheduled payment release.',
      inputs: [
        { key: 'variance', label: 'Price variance', type: 'range', min: 0, max: 15, step: 0.5, value: 1.5, format: 'percent' },
        { key: 'received', label: 'Goods received', type: 'toggle', value: true },
        { key: 'resolved', label: 'AP resolves exception', type: 'toggle', value: true }
      ],
      nodes: [
        { id: 'start', type: 'start', label: 'Bill Received', sub: 'Email capture / OCR', x: 0, y: 1, sla: 0,
          description: 'Vendor Bill created from the AP inbox (OCR capture) or transformed from a Purchase Order.',
          trigger: 'After Record Submit · Create', actions: [['Set Field Value', 'Approval Status → Pending Approval']] },
        { id: 'link', type: 'script', label: 'Link PO & Receipt', sub: 'Map/Reduce lookup', x: 1, y: 1, sla: 0.2,
          description: 'Finds the originating Purchase Order and related Item Receipts, aggregating quantities and rates per line.',
          trigger: 'Custom Action', actions: [['Custom Action', 'customscript_bu_wa_three_way_match']], script: 'match' },
        { id: 'receipt', type: 'decision', label: 'Receipt Exists?', sub: 'Qty received ≥ billed', x: 2, y: 1, sla: 0.05,
          description: 'Bills without a matching receipt are held until the warehouse confirms delivery.',
          trigger: 'Condition', actions: [['Formula', 'SUM({receipt.quantity}) >= {quantity}']] },
        { id: 'wait', type: 'state', label: 'Await Receipt', sub: 'Warehouse confirmation', x: 2, y: 2.35, sla: 24,
          description: 'Bill parked. Scheduled transition re-checks every 6 hours for a new Item Receipt.',
          trigger: 'Scheduled · Every 6h', actions: [['Send Email', 'Receiving team · Missing receipt'], ['Scheduled Transition', 'Re-evaluate match']] },
        { id: 'match', type: 'decision', label: 'Within Tolerance?', sub: 'Variance ≤ 3% or $250', x: 3, y: 1, sla: 0.05,
          description: 'Price & quantity variance validated against the tolerance defined per subsidiary on a custom record.',
          trigger: 'Condition · Script result', actions: [['Script Result', 'MATCHED · VARIANCE']] },
        { id: 'exception', type: 'state', label: 'AP Exception Queue', sub: 'Variance review', x: 3, y: 2.35, sla: 12,
          description: 'AP specialist reviews the variance, requests a credit memo from the vendor or adjusts the bill.',
          trigger: 'Entry · Buttons', actions: [['Add Button', 'Accept Variance'], ['Add Button', 'Request Credit'], ['Create Record', 'Task · AP Specialist']] },
        { id: 'approve', type: 'action', label: 'Auto-Approve', sub: 'Touchless processing', x: 4, y: 1, sla: 0.05,
          description: 'Matched bills are approved without human touch — the core KPI of the AP automation program.',
          trigger: 'Entry', actions: [['Set Field Value', 'Approval Status → Approved'], ['Set Field Value', 'custbody_bu_touchless → T']] },
        { id: 'schedule', type: 'state', label: 'Payment Scheduled', sub: 'Next payment run', x: 5, y: 1, sla: 48,
          description: 'Bill is placed in the next Bill Payment batch respecting vendor terms and early-pay discounts.',
          trigger: 'Entry', actions: [['Set Field Value', 'Payment Hold → F'], ['Set Field Value', 'Due Date (terms-adjusted)']] },
        { id: 'rejected', type: 'reject', label: 'Rejected', sub: 'Returned to vendor', x: 4, y: 2.35, sla: 0.1,
          description: 'Disputed bill is rejected and the vendor notified through the vendor portal.',
          trigger: 'Entry', actions: [['Set Field Value', 'Approval Status → Rejected'], ['Send Email', 'Vendor contact']] },
        { id: 'end', type: 'end', label: 'Paid', sub: 'Bill Payment posted', x: 6, y: 1, sla: 0,
          description: 'Payment posted to GL, vendor remittance advice emailed.', trigger: 'Exit', actions: [['Complete', 'Workflow finished']] }
      ],
      edges: [
        { from: 'start', to: 'link' },
        { from: 'link', to: 'receipt' },
        { from: 'receipt', to: 'match', label: 'Yes', when: (s, c) => s.received || c.visits.wait > 0 },
        { from: 'receipt', to: 'wait', label: 'No', when: (s) => !s.received },
        { from: 'wait', to: 'receipt', label: 'Re-check' },
        { from: 'match', to: 'approve', label: 'Match', when: (s, c) => s.variance <= 3 || c.visits.exception > 0 },
        { from: 'match', to: 'exception', label: 'Variance', when: (s) => s.variance > 3 },
        { from: 'exception', to: 'match', label: 'Adjusted', when: (s) => s.resolved },
        { from: 'exception', to: 'rejected', label: 'Dispute', when: (s) => !s.resolved },
        { from: 'approve', to: 'schedule' },
        { from: 'schedule', to: 'end' }
      ],
      scripts: {
        match: {
          file: 'bu_wa_three_way_match.js',
          type: 'Workflow Action Script',
          code: [
            '/**',
            ' * @NApiVersion 2.1',
            ' * @NScriptType WorkflowActionScript',
            ' * @description PO / Item Receipt / Vendor Bill 3-way match.',
            ' */',
            "define(['N/query', 'N/runtime'], (query, runtime) => {",
            '',
            '  const onAction = ({ newRecord: bill }) => {',
            "    const script = runtime.getCurrentScript();",
            "    const tolPct = Number(script.getParameter({ name: 'custscript_bu_tol_pct' })) || 3;",
            "    const tolAmt = Number(script.getParameter({ name: 'custscript_bu_tol_amt' })) || 250;",
            '',
            '    // SuiteQL: received qty & PO rate per item for the linked PO',
            '    const rows = query.runSuiteQL({',
            "      query: 'SELECT tl.item, SUM(tl.quantity) qty, MAX(tl.rate) rate ' +",
            "             'FROM transactionline tl WHERE tl.createdfrom = ? GROUP BY tl.item',",
            "      params: [bill.getValue('podocnum')]",
            '    }).asMappedResults();',
            '',
            "    const expected = rows.reduce((t, r) => t + r.qty * r.rate, 0);",
            "    const billed = Number(bill.getValue('usertotal'));",
            '    const diff = Math.abs(billed - expected);',
            '',
            "    bill.setValue({ fieldId: 'custbody_bu_match_variance', value: diff });",
            '',
            "    return (diff <= tolAmt || diff / expected * 100 <= tolPct) ? 'MATCHED' : 'VARIANCE';",
            '  };',
            '',
            '  return { onAction };',
            '});'
          ].join('\n')
        }
      }
    },

    /* ────────────────────────────────────────────────────────── */
    {
      id: 'purchase-requisition',
      name: 'Purchase Requisition to PO',
      category: 'Procure to Pay',
      record: 'Purchase Requisition',
      version: '1.8',
      color: '#f59e0b',
      summary:
        'Employee requisitions validated against department budget, routed through ' +
        'the supervisor hierarchy and auto-converted into a Purchase Order.',
      inputs: [
        { key: 'amount', label: 'Requisition amount', type: 'range', min: 100, max: 60000, step: 100, value: 4200, format: 'currency' },
        { key: 'budget', label: 'Budget available', type: 'toggle', value: true },
        { key: 'preferred', label: 'Preferred vendor', type: 'toggle', value: true }
      ],
      nodes: [
        { id: 'start', type: 'start', label: 'Requisition Submitted', sub: 'Employee Center', x: 0, y: 1, sla: 0,
          description: 'Employee raises a requisition from the Employee Center role.', trigger: 'On Create',
          actions: [['Set Field Value', 'Status → Pending Approval']] },
        { id: 'budget', type: 'decision', label: 'Budget Check', sub: 'Dept. budget vs. actuals', x: 1, y: 1, sla: 0.05,
          description: 'Compares the requisition against remaining budget for the department, class and period.',
          trigger: 'Custom Action', actions: [['Custom Action', 'customscript_bu_wa_budget_check']], script: 'budget' },
        { id: 'finance', type: 'state', label: 'Finance Review', sub: 'Over-budget exception', x: 1, y: 2.35, sla: 8,
          description: 'FP&A analyst decides whether to reallocate budget or decline.', trigger: 'Entry · Buttons',
          actions: [['Add Button', 'Reallocate'], ['Add Button', 'Decline']] },
        { id: 'super', type: 'state', label: 'Supervisor', sub: 'Direct manager', x: 2, y: 1, sla: 4,
          description: 'Employee\'s supervisor approves. Approval routing walks the employee hierarchy up to the approval limit.',
          trigger: 'Entry · Buttons', actions: [['Set Field Value', 'Next Approver → {employee.supervisor}'], ['Add Button', 'Approve']] },
        { id: 'limit', type: 'decision', label: 'Within Limit?', sub: 'Approver purchase limit', x: 3, y: 1, sla: 0.05,
          description: 'If the amount exceeds the approver\'s purchase limit, the requisition climbs one level.',
          trigger: 'Condition', actions: [['Formula', '{total} <= {nextapprover.purchaseorderapprovallimit}']] },
        { id: 'vp', type: 'state', label: 'VP Approval', sub: 'Above $25,000', x: 3, y: -0.35, sla: 12,
          description: 'Vice President of the department approves high-value spend.', trigger: 'Entry · Buttons',
          actions: [['Add Button', 'Approve'], ['Send Email', 'VP · Pending approval digest']] },
        { id: 'sourcing', type: 'decision', label: 'Preferred Vendor?', sub: 'Item vendor list', x: 4, y: 1, sla: 0.05,
          description: 'Checks whether all lines have a preferred vendor; otherwise procurement must source.',
          trigger: 'Condition', actions: [['Formula', 'COUNT(lines without vendor) = 0']] },
        { id: 'rfq', type: 'state', label: 'Procurement RFQ', sub: 'Sourcing 3 quotes', x: 4, y: 2.35, sla: 24,
          description: 'Procurement team requests quotes and selects the vendor.', trigger: 'Entry',
          actions: [['Create Record', 'Task · Procurement'], ['Set Field Value', 'Vendor (selected)']] },
        { id: 'po', type: 'script', label: 'Create Purchase Order', sub: 'record.transform', x: 5, y: 1, sla: 0.1,
          description: 'Requisition transformed into one PO per vendor and emailed to the supplier.',
          trigger: 'Custom Action', actions: [['Transform Record', 'Requisition → Purchase Order'], ['Send Email', 'Vendor · PO PDF']] },
        { id: 'declined', type: 'reject', label: 'Declined', sub: 'Budget not available', x: 2, y: 2.35, sla: 0,
          description: 'Requisition rejected with reason.', trigger: 'Entry', actions: [['Set Field Value', 'Status → Rejected']] },
        { id: 'end', type: 'end', label: 'PO Issued', sub: 'Sent to supplier', x: 6, y: 1, sla: 0,
          description: 'PO issued and committed against budget.', trigger: 'Exit', actions: [['Complete', 'Workflow finished']] }
      ],
      edges: [
        { from: 'start', to: 'budget' },
        { from: 'budget', to: 'super', label: 'OK', when: (s) => s.budget },
        { from: 'budget', to: 'finance', label: 'Over', when: (s) => !s.budget },
        { from: 'finance', to: 'super', label: 'Reallocate', when: (s) => s.amount <= 25000 },
        { from: 'finance', to: 'declined', label: 'Decline', when: (s) => s.amount > 25000 },
        { from: 'super', to: 'limit' },
        { from: 'limit', to: 'sourcing', label: 'Yes', when: (s, c) => s.amount <= 25000 || c.visits.vp > 0 },
        { from: 'limit', to: 'vp', label: 'Escalate', when: (s) => s.amount > 25000 },
        { from: 'vp', to: 'limit' },
        { from: 'sourcing', to: 'po', label: 'Yes', when: (s) => s.preferred },
        { from: 'sourcing', to: 'rfq', label: 'No', when: (s) => !s.preferred },
        { from: 'rfq', to: 'po', label: 'Awarded' },
        { from: 'po', to: 'end' }
      ],
      scripts: {
        budget: {
          file: 'bu_wa_budget_check.js',
          type: 'Workflow Action Script',
          code: [
            '/**',
            ' * @NApiVersion 2.1',
            ' * @NScriptType WorkflowActionScript',
            ' * @description Budget vs. actuals check for requisitions.',
            ' */',
            "define(['N/query'], (query) => {",
            '',
            '  const remainingBudget = (dept, period) => {',
            '    const [row] = query.runSuiteQL({',
            "      query: 'SELECT b.amount - NVL(a.spent, 0) AS remaining ' +",
            "             'FROM customrecord_bu_dept_budget b ' +",
            "             'LEFT JOIN (SELECT department, SUM(amount) spent FROM transactionline ' +",
            "             '  WHERE postingperiod = ? GROUP BY department) a ON a.department = b.custrecord_dept ' +",
            "             'WHERE b.custrecord_dept = ? AND b.custrecord_period = ?',",
            '      params: [period, dept, period]',
            '    }).asMappedResults();',
            '    return row ? Number(row.remaining) : 0;',
            '  };',
            '',
            '  const onAction = ({ newRecord: req }) => {',
            "    const remaining = remainingBudget(req.getValue('department'), req.getValue('postingperiod'));",
            "    return Number(req.getValue('estimatedtotal')) <= remaining ? 'OK' : 'OVER';",
            '  };',
            '',
            '  return { onAction };',
            '});'
          ].join('\n')
        }
      }
    },

    /* ────────────────────────────────────────────────────────── */
    {
      id: 'journal-entry-approval',
      name: 'Journal Entry Approval',
      category: 'Record to Report',
      record: 'Journal Entry',
      version: '2.0',
      color: '#ec4899',
      summary:
        'SOX-compliant segregation of duties for manual journals, with risk scoring, ' +
        'controller review and period-close guardrails.',
      inputs: [
        { key: 'amount', label: 'Journal amount', type: 'range', min: 1000, max: 500000, step: 1000, value: 75000, format: 'currency' },
        { key: 'sameUser', label: 'Approver = creator', type: 'toggle', value: false },
        { key: 'periodOpen', label: 'Period open', type: 'toggle', value: true }
      ],
      nodes: [
        { id: 'start', type: 'start', label: 'Journal Saved', sub: 'Manual / CSV import', x: 0, y: 1, sla: 0,
          description: 'Manual journal created by an accountant.', trigger: 'Before Submit · Create / Edit',
          actions: [['Set Field Value', 'Approved → F']] },
        { id: 'sod', type: 'decision', label: 'Segregation of Duties', sub: 'Creator ≠ approver', x: 1, y: 1, sla: 0.02,
          description: 'Blocks self-approval — a SOX control enforced at workflow level and by a User Event script.',
          trigger: 'Condition', actions: [['Formula', '{createdby} <> {currentuser}']], script: 'sod' },
        { id: 'blocked', type: 'reject', label: 'SoD Violation', sub: 'Logged to audit', x: 1, y: 2.35, sla: 0,
          description: 'Attempt is logged in a custom audit record and Internal Audit is notified.',
          trigger: 'Entry', actions: [['Create Record', 'customrecord_bu_sox_audit'], ['Send Email', 'Internal Audit']] },
        { id: 'risk', type: 'script', label: 'Risk Score', sub: 'Amount · accounts · timing', x: 2, y: 1, sla: 0.05,
          description: 'Scores the journal using amount, sensitive GL accounts (cash, revenue, equity) and posting date proximity to close.',
          trigger: 'Custom Action', actions: [['Custom Action', 'Return LOW / HIGH']] },
        { id: 'level', type: 'decision', label: 'Risk Level', sub: 'High if > $100K', x: 3, y: 1, sla: 0.02,
          description: 'Routes high-risk journals to the Controller.', trigger: 'Condition', actions: [['Script Result', 'LOW · HIGH']] },
        { id: 'mgr', type: 'state', label: 'Accounting Manager', sub: 'Low risk', x: 4, y: 0.3, sla: 4,
          description: 'Accounting Manager reviews support attachments and approves.', trigger: 'Entry · Buttons',
          actions: [['Add Button', 'Approve'], ['Add Button', 'Reject']] },
        { id: 'ctrl', type: 'state', label: 'Controller', sub: 'High risk', x: 4, y: 1.7, sla: 8,
          description: 'Controller review with mandatory supporting documentation.', trigger: 'Entry · Buttons',
          actions: [['Add Button', 'Approve'], ['Field Mandatory', 'Supporting file attached']] },
        { id: 'period', type: 'decision', label: 'Period Open?', sub: 'Accounting period lock', x: 5, y: 1, sla: 0.02,
          description: 'Prevents posting into closed periods; reroutes to the next open period.', trigger: 'Condition',
          actions: [['Formula', '{postingperiod.closed} = F']] },
        { id: 'reroute', type: 'action', label: 'Move to Open Period', sub: 'Auto-adjust date', x: 5, y: 2.35, sla: 0.1,
          description: 'Moves the posting date to the first day of the next open period and annotates the memo.',
          trigger: 'Entry', actions: [['Set Field Value', 'Posting Period → next open'], ['Set Field Value', 'Memo += "[Re-dated]"']] },
        { id: 'end', type: 'end', label: 'Posted to GL', sub: 'Approved = T', x: 6, y: 1, sla: 0,
          description: 'Journal posts to the General Ledger.', trigger: 'Exit', actions: [['Set Field Value', 'Approved → T']] }
      ],
      edges: [
        { from: 'start', to: 'sod' },
        { from: 'sod', to: 'risk', label: 'Pass', when: (s) => !s.sameUser },
        { from: 'sod', to: 'blocked', label: 'Violation', when: (s) => s.sameUser },
        { from: 'risk', to: 'level' },
        { from: 'level', to: 'mgr', label: 'Low', when: (s) => s.amount <= 100000 },
        { from: 'level', to: 'ctrl', label: 'High', when: (s) => s.amount > 100000 },
        { from: 'mgr', to: 'period' },
        { from: 'ctrl', to: 'period' },
        { from: 'period', to: 'end', label: 'Open', when: (s, c) => s.periodOpen || c.visits.reroute > 0 },
        { from: 'period', to: 'reroute', label: 'Closed', when: (s) => !s.periodOpen },
        { from: 'reroute', to: 'end' }
      ],
      scripts: {
        sod: {
          file: 'bu_ue_journal_sod.js',
          type: 'User Event Script',
          code: [
            '/**',
            ' * @NApiVersion 2.1',
            ' * @NScriptType UserEventScript',
            ' * @description SOX: prevent self-approval of journal entries.',
            ' */',
            "define(['N/runtime', 'N/error', 'N/record'], (runtime, error, record) => {",
            '',
            '  const beforeSubmit = ({ newRecord, oldRecord, type, UserEventType }) => {',
            '    if (type !== UserEventType.EDIT) return;',
            '',
            "    const approving = newRecord.getValue('approved') && !oldRecord.getValue('approved');",
            "    const creator = String(newRecord.getValue('custbody_bu_created_by'));",
            '    const user = String(runtime.getCurrentUser().id);',
            '',
            '    if (approving && creator === user) {',
            "      record.create({ type: 'customrecord_bu_sox_audit' })",
            "        .setValue({ fieldId: 'custrecord_bu_txn', value: newRecord.id })",
            "        .setValue({ fieldId: 'custrecord_bu_user', value: user })",
            '        .save();',
            '',
            '      throw error.create({',
            "        name: 'BU_SOD_VIOLATION',",
            "        message: 'You cannot approve a journal you created.',",
            '        notifyOff: false',
            '      });',
            '    }',
            '  };',
            '',
            '  return { beforeSubmit };',
            '});'
          ].join('\n')
        }
      }
    },

    /* ────────────────────────────────────────────────────────── */
    {
      id: 'customer-onboarding',
      name: 'Customer Onboarding & KYC',
      category: 'CRM',
      record: 'Customer',
      version: '1.5',
      color: '#10b981',
      summary:
        'Lead conversion to an active customer: KYC verification, tax validation, ' +
        'credit limit assignment and welcome automation.',
      inputs: [
        { key: 'score', label: 'Credit score', type: 'range', min: 300, max: 850, step: 10, value: 720, format: 'number' },
        { key: 'kyc', label: 'KYC documents valid', type: 'toggle', value: true },
        { key: 'region', label: 'Region', type: 'select', value: 'us', options: [['us', 'United States'], ['eu', 'European Union'], ['apac', 'APAC']] }
      ],
      nodes: [
        { id: 'start', type: 'start', label: 'Lead Converted', sub: 'Prospect → Customer', x: 0, y: 1, sla: 0,
          description: 'Opportunity closed-won converts the prospect into a customer record.', trigger: 'After Submit · Stage change',
          actions: [['Set Field Value', 'Status → CUSTOMER-Onboarding']] },
        { id: 'kyc', type: 'decision', label: 'KYC Verification', sub: 'External API (N/https)', x: 1, y: 1, sla: 0.5,
          description: 'Customer identity and sanctions screening through an external KYC provider via RESTlet / N/https.',
          trigger: 'Custom Action', actions: [['Custom Action', 'customscript_bu_wa_kyc'], ['Branch', 'VERIFIED · FAILED']], script: 'kyc' },
        { id: 'docs', type: 'state', label: 'Request Documents', sub: 'Customer portal', x: 1, y: 2.35, sla: 48,
          description: 'Customer is asked to upload missing documents through the portal.', trigger: 'Entry',
          actions: [['Send Email', 'Customer · Document request'], ['Scheduled Transition', 'Reminder after 48h']] },
        { id: 'tax', type: 'action', label: 'Tax Validation', sub: 'VAT / EIN / GST', x: 2, y: 1, sla: 0.2,
          description: 'Validates tax registration based on region and assigns the correct tax nexus and tax code.',
          trigger: 'Entry', actions: [['Set Field Value', 'Tax Item (by nexus)'], ['Set Field Value', 'VAT Reg. Number validated']] },
        { id: 'credit', type: 'decision', label: 'Credit Tier', sub: 'Score based', x: 3, y: 1, sla: 0.05,
          description: 'Assigns the credit limit and payment terms based on the bureau score.', trigger: 'Condition',
          actions: [['Branch', '≥ 700 Standard · < 700 Prepay']] },
        { id: 'std', type: 'action', label: 'Standard Terms', sub: 'Net 30 · $50K limit', x: 4, y: 0.3, sla: 0.05,
          description: 'Net 30 terms, $50,000 credit limit.', trigger: 'Entry',
          actions: [['Set Field Value', 'Terms → Net 30'], ['Set Field Value', 'Credit Limit → 50,000']] },
        { id: 'prepay', type: 'action', label: 'Prepayment Terms', sub: 'Deposit required', x: 4, y: 1.7, sla: 0.05,
          description: 'Customer must pay a deposit before first fulfillment.', trigger: 'Entry',
          actions: [['Set Field Value', 'Terms → Prepayment'], ['Set Field Value', 'Credit Hold → ON']] },
        { id: 'welcome', type: 'action', label: 'Welcome Journey', sub: 'Email + portal access', x: 5, y: 1, sla: 0.1,
          description: 'Grants customer center access and triggers the welcome email campaign.', trigger: 'Entry',
          actions: [['Send Email', 'Welcome pack'], ['Set Field Value', 'Give Access → T'], ['Create Record', 'Phone call · CSM intro']] },
        { id: 'fail', type: 'reject', label: 'Onboarding Failed', sub: 'Compliance alert', x: 2, y: 2.35, sla: 0,
          description: 'Customer set to inactive and compliance alerted.', trigger: 'Entry',
          actions: [['Set Field Value', 'Inactive → T'], ['Send Email', 'Compliance team']] },
        { id: 'end', type: 'end', label: 'Active Customer', sub: 'Ready to transact', x: 6, y: 1, sla: 0,
          description: 'Customer is active and can place orders.', trigger: 'Exit', actions: [['Set Field Value', 'Status → CUSTOMER-Active']] }
      ],
      edges: [
        { from: 'start', to: 'kyc' },
        { from: 'kyc', to: 'tax', label: 'Verified', when: (s, c) => s.kyc || c.visits.docs > 0 },
        { from: 'kyc', to: 'docs', label: 'Missing', when: (s, c) => !s.kyc && c.visits.docs === 0 },
        { from: 'docs', to: 'kyc', label: 'Uploaded', when: (s) => s.region !== 'apac' },
        { from: 'docs', to: 'fail', label: 'Expired', when: (s) => s.region === 'apac' },
        { from: 'tax', to: 'credit' },
        { from: 'credit', to: 'std', label: '≥ 700', when: (s) => s.score >= 700 },
        { from: 'credit', to: 'prepay', label: '< 700', when: (s) => s.score < 700 },
        { from: 'std', to: 'welcome' },
        { from: 'prepay', to: 'welcome' },
        { from: 'welcome', to: 'end' }
      ],
      scripts: {
        kyc: {
          file: 'bu_wa_kyc_verify.js',
          type: 'Workflow Action Script',
          code: [
            '/**',
            ' * @NApiVersion 2.1',
            ' * @NScriptType WorkflowActionScript',
            ' * @description KYC & sanctions screening via external provider.',
            ' */',
            "define(['N/https', 'N/runtime', 'N/log'], (https, runtime, log) => {",
            '',
            '  const onAction = ({ newRecord: customer }) => {',
            "    const endpoint = runtime.getCurrentScript().getParameter({ name: 'custscript_bu_kyc_url' });",
            '',
            '    const res = https.post({',
            '      url: endpoint,',
            "      headers: { 'Content-Type': 'application/json' },",
            '      body: JSON.stringify({',
            "        name: customer.getValue('companyname'),",
            "        country: customer.getValue('billcountry'),",
            "        taxId: customer.getValue('vatregnumber')",
            '      })',
            '    });',
            '',
            '    if (res.code !== 200) {',
            "      log.error('KYC provider error', res.body);",
            "      return 'FAILED';",
            '    }',
            '',
            '    const { status, riskLevel } = JSON.parse(res.body);',
            "    customer.setValue({ fieldId: 'custentity_bu_kyc_risk', value: riskLevel });",
            "    return status === 'CLEAR' ? 'VERIFIED' : 'FAILED';",
            '  };',
            '',
            '  return { onAction };',
            '});'
          ].join('\n')
        }
      }
    },

    /* ────────────────────────────────────────────────────────── */
    {
      id: 'expense-report-approval',
      name: 'Expense Report Approval',
      category: 'Employee',
      record: 'Expense Report',
      version: '2.1',
      color: '#f43f5e',
      summary:
        'Policy-driven expense approvals with receipt enforcement, per-diem checks, ' +
        'supervisor → accounting review and reimbursement via ACH.',
      inputs: [
        { key: 'amount', label: 'Report total', type: 'range', min: 50, max: 8000, step: 50, value: 1250, format: 'currency' },
        { key: 'receipts', label: 'All receipts attached', type: 'toggle', value: true },
        { key: 'policy', label: 'Within policy', type: 'toggle', value: true }
      ],
      nodes: [
        { id: 'start', type: 'start', label: 'Report Submitted', sub: 'Mobile / Employee Center', x: 0, y: 1, sla: 0,
          description: 'Employee submits an expense report from the NetSuite mobile app.', trigger: 'On Create',
          actions: [['Set Field Value', 'Status → Pending Supervisor Approval']] },
        { id: 'receipts', type: 'decision', label: 'Receipts Check', sub: 'Lines > $75 need receipt', x: 1, y: 1, sla: 0.02,
          description: 'Enforces receipt attachment for each line above the policy threshold.', trigger: 'Condition',
          actions: [['Formula', 'COUNT(lines > 75 AND receipt = F) = 0']] },
        { id: 'returned', type: 'state', label: 'Returned to Employee', sub: 'Attach receipts', x: 1, y: 2.35, sla: 24,
          description: 'Report returned to the employee with the list of lines missing receipts.', trigger: 'Entry',
          actions: [['Send Email', 'Employee · Missing receipts'], ['Set Field Value', 'Status → In Progress']] },
        { id: 'policy', type: 'script', label: 'Policy Engine', sub: 'Per-diem · category caps', x: 2, y: 1, sla: 0.05,
          description: 'Validates per-diem rates by city, category caps and duplicate detection.', trigger: 'Custom Action',
          actions: [['Custom Action', 'Policy rules engine'], ['Set Field Value', 'custbody_bu_policy_flags']] },
        { id: 'super', type: 'state', label: 'Supervisor', sub: 'Direct manager', x: 3, y: 1, sla: 6,
          description: 'Supervisor approves; policy flags highlighted on the form via client script.', trigger: 'Entry · Buttons',
          actions: [['Add Button', 'Approve'], ['Add Button', 'Reject']] },
        { id: 'big', type: 'decision', label: 'Requires Accounting?', sub: '> $2,500 or flagged', x: 4, y: 1, sla: 0.02,
          description: 'Large or flagged reports get a second review from accounting.', trigger: 'Condition',
          actions: [['Formula', '{total} > 2500 OR {custbody_bu_policy_flags} IS NOT NULL']] },
        { id: 'acct', type: 'state', label: 'Accounting Review', sub: 'Audit & GL coding', x: 4, y: 2.35, sla: 12,
          description: 'Accounting validates GL coding and policy exceptions.', trigger: 'Entry · Buttons',
          actions: [['Add Button', 'Approve'], ['Set Field Value', 'Accounting Approval → T']] },
        { id: 'pay', type: 'action', label: 'Reimburse via ACH', sub: 'Next payroll batch', x: 5, y: 1, sla: 24,
          description: 'Reimbursement included in the next ACH batch.', trigger: 'Entry',
          actions: [['Set Field Value', 'Status → Approved (Overridden by Accounting)'], ['Transform Record', 'Bill Payment (Employee)']] },
        { id: 'end', type: 'end', label: 'Reimbursed', sub: 'Employee paid', x: 6, y: 1, sla: 0,
          description: 'Employee reimbursed and notified.', trigger: 'Exit', actions: [['Send Email', 'Employee · Paid']] }
      ],
      edges: [
        { from: 'start', to: 'receipts' },
        { from: 'receipts', to: 'policy', label: 'Complete', when: (s, c) => s.receipts || c.visits.returned > 0 },
        { from: 'receipts', to: 'returned', label: 'Missing', when: (s) => !s.receipts },
        { from: 'returned', to: 'receipts', label: 'Resubmitted' },
        { from: 'policy', to: 'super' },
        { from: 'super', to: 'big' },
        { from: 'big', to: 'pay', label: 'No', when: (s) => s.amount <= 2500 && s.policy },
        { from: 'big', to: 'acct', label: 'Yes', when: (s) => s.amount > 2500 || !s.policy },
        { from: 'acct', to: 'pay' },
        { from: 'pay', to: 'end' }
      ],
      scripts: {}
    }
  ];

  /** Visual metadata per node type. */
  const NODE_TYPES = {
    start:    { label: 'Trigger',  color: '#10b981', icon: 'M8 5v14l11-7z' },
    state:    { label: 'State',    color: '#8b5cf6', icon: 'M12 2a10 10 0 100 20 10 10 0 000-20zm1 5v5.4l4 2.3-.8 1.3L11 13V7h2z' },
    decision: { label: 'Decision', color: '#f59e0b', icon: 'M12 2l10 10-10 10L2 12 12 2zm0 3.8L5.8 12 12 18.2 18.2 12 12 5.8z' },
    action:   { label: 'Action',   color: '#22d3ee', icon: 'M13 2L4 14h7l-1 8 9-12h-7l1-8z' },
    script:   { label: 'Script',   color: '#ec4899', icon: 'M8.6 16.6L4 12l4.6-4.6L7.2 6 1.2 12l6 6 1.4-1.4zm6.8 0L20 12l-4.6-4.6L16.8 6l6 6-6 6-1.4-1.4z' },
    reject:   { label: 'Rejected', color: '#f43f5e', icon: 'M12 2a10 10 0 100 20 10 10 0 000-20zm4.3 12.9l-1.4 1.4L12 13.4l-2.9 2.9-1.4-1.4 2.9-2.9-2.9-2.9 1.4-1.4 2.9 2.9 2.9-2.9 1.4 1.4-2.9 2.9 2.9 2.9z' },
    end:      { label: 'Complete', color: '#34d399', icon: 'M12 2a10 10 0 100 20 10 10 0 000-20zm-1.4 14.6L6 12l1.4-1.4 3.2 3.2 6-6L18 9.2l-7.4 7.4z' }
  };

  window.NS_WORKFLOWS = WORKFLOWS;
  window.NS_NODE_TYPES = NODE_TYPES;
})();
