import { fmtDate, fmtMoney, txSigned } from '../utils.js';

// Shared transaction table for Sales & Money and Show detail.
// Rows come from GET /api/transactions (joined card_name / show_name).
export default function TransactionTable({ transactions, onDelete, onEdit, showShowColumn = true }) {
  const hasActions = Boolean(onDelete || onEdit);
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Description</th>
            <th>Card</th>
            {showShowColumn && <th>Show</th>}
            <th className="num">Qty</th>
            <th className="num">Unit</th>
            <th className="num">Amount</th>
            {hasActions && <th />}
          </tr>
        </thead>
        <tbody>
          {transactions.map((tx) => {
            const signed = txSigned(tx);
            return (
              <tr key={tx.id}>
                <td className="nowrap">{fmtDate(tx.date)}</td>
                <td>
                  <span className={`pill pill-${tx.type}`}>{tx.type}</span>
                </td>
                <td className="tx-desc">{tx.description || '—'}</td>
                <td>{tx.card_name || '—'}</td>
                {showShowColumn && <td>{tx.show_name || '—'}</td>}
                <td className="num">{tx.quantity ?? '—'}</td>
                <td className="num">{tx.unit_price != null ? fmtMoney(tx.unit_price) : '—'}</td>
                <td className={`num amount ${signed < 0 ? 'neg' : 'pos'}`}>
                  {fmtMoney(signed, { sign: true })}
                </td>
                {hasActions && (
                  <td className="num nowrap">
                    {onEdit && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => onEdit(tx)}
                        title="Edit transaction (assign a show, fix details)"
                      >
                        Edit
                      </button>
                    )}
                    {onDelete && (
                      <button
                        type="button"
                        className="btn btn-sm btn-danger-ghost"
                        onClick={() => onDelete(tx)}
                        title="Delete transaction"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Standard confirm copy for deleting a transaction — explains the inventory
// undo behavior from the contract (DELETE /api/transactions/:id).
export function confirmDeleteTransaction(tx) {
  const consequence =
    tx.type === 'sale'
      ? 'Deleting a sale puts its quantity back into inventory (if the card still exists).'
      : tx.type === 'purchase'
        ? 'Deleting a purchase removes its quantity from inventory (if the card still exists, floored at 0).'
        : 'This only removes the record — inventory is not affected.';
  return window.confirm(`Delete this ${tx.type}?\n\n${consequence}`);
}
