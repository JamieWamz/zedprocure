# Codd's 13 Rules — ZedProcure PostgreSQL Mapping

Codd's rules describe what a relational DBMS must provide; they are not thirteen
application features that can be reimplemented in Express. ZedProcure relies on
PostgreSQL for the DBMS-level guarantees and uses migrations, constraints, views,
and transaction boundaries for the application-controlled guarantees.

| Rule | Implementation / evidence |
|---|---|
| 0. Foundation | PostgreSQL is the sole authoritative relational store. Financial state is not computed from browser state or a parallel file store. |
| 1. Information | Business facts are represented as values in normalized tables. Monetization settings, subscriptions, bid charges, order prices, escrow allocations, and withdrawals each have relations with typed columns. |
| 2. Guaranteed access | Rows have primary keys and values are addressable by table, key, and column. New finance relations use UUID keys; singleton configuration has a checked Boolean key. |
| 3. Systematic nulls | Optional associations use SQL `NULL` (for example, an optional payment transaction on a subscription-funded bid charge). `NOT NULL` is used when absence would make a financial record invalid. |
| 4. Online catalog | PostgreSQL exposes schemas, columns, constraints, indexes, and views through `information_schema` and `pg_catalog`; migrations are the versioned application catalog. |
| 5. Comprehensive language | SQL is used for DDL, querying, integrity, authorization projections, and ACID transaction control. Application SQL is parameterized. |
| 6. View updating | PostgreSQL supports updateable simple views. ZedProcure's buyer/supplier quote views are deliberately read projections; writes go through transaction services so fee and ledger invariants cannot be bypassed. |
| 7. Set-level operations | Bid comparisons, response totals, wallet locks, de-duplication, and reporting use set-based SQL. Row loops are limited to transactional journal-line creation and validated BoQ inserts. |
| 8. Physical independence | Routes depend on relations and views, not heap layout or file locations. Indexes can change without API changes. |
| 9. Logical independence | Additive migrations and role-specific projections preserve existing API concepts while normalized finance relations evolve independently. |
| 10. Integrity independence | Foreign keys, `UNIQUE`, `CHECK`, and `NOT NULL` constraints live in PostgreSQL. Order equations enforce buyer total, supplier payout, spread, and platform revenue at the data layer. |
| 11. Distribution independence | The application uses PostgreSQL's connection interface and transaction semantics without relying on server-local table placement. A future managed/replicated PostgreSQL topology does not change domain logic. |
| 12. Non-subversion | Financial writes use the same constrained relations and ACID paths. There is no lower-level application path that can bypass price equations, unique bid charges, wallet balance checks, or escrow status locks. |

## Financial relational invariants

The monetization migration enforces these equations declaratively:

```text
spread_amount = buyer_price - supplier_price
total_amount = buyer_price + buyer_protection_fee + express_match_fee
supplier_payout_amount = supplier_price
platform_revenue_amount = spread_amount + buyer_protection_fee + express_match_fee
subsidy_amount = greatest(-platform_revenue_amount, 0)
```

The migration also creates public-safe `buyer_order_quotes` and
`supplier_order_payouts` views. Neither view contains the internal spread.

## Operational boundary

Rules 0, 4, 5, 6, 8, and 11 are principally PostgreSQL capabilities. Application
code can select and preserve them, but cannot make a non-relational engine comply
with them. CI should therefore run migrations against a supported PostgreSQL
version and must not substitute an in-memory/document database for finance tests.
