# Olive Storage — App Flow (draft v1, for owner review)

Renders as a diagram on GitHub and in most Markdown viewers.

## 1. Main flow

```mermaid
flowchart TD
    START([Open app]) --> HOME[Home]

    HOME --> STOCK[Stock]
    HOME --> SELL[Sell]
    HOME --> DEBT[Debts]
    HOME --> EXP[Monthly costs]
    HOME --> DASH[Dashboard]

    %% STOCK
    STOCK --> S1[Receive goods: enter amount]
    S1 --> S2[Name the item]
    S2 --> S3[Choose unit: kg / box / piece ...]
    S3 --> S4[Enter buy price]
    S4 --> S5[Enter default selling price]
    S5 --> S6[(Save: stock increases)]

    %% SELL
    SELL --> L5[1. Client name first: pick or add]
    L5 --> L1[2. Add item from stock]
    L1 --> L2[Selling price pre-filled from default - can edit]
    L2 --> L3[Enter amount]
    L3 --> L4{Enough in stock?}
    L4 -- No --> L3
    L4 -- Yes --> L10{Add another item?}
    L10 -- Yes --> L1
    L10 -- No --> L6[3. Invoice total, enter amount paid]
    L6 --> L7{Paid in full?}
    L7 -- Yes --> L8[(Save sale: stock decreases)]
    L7 -- No --> L9[(Save sale + debt = total - paid)]
    L9 --> L8
    L8 -.-> PR[Print invoice - planned for later]

    %% DEBT
    DEBT --> D1[List of clients who owe]
    D1 --> D2[Client pays part or all]
    D2 --> D3[(Debt decreases, payment recorded)]

    %% EXPENSES
    EXP --> E1[Pick month]
    E1 --> E2[Electricity]
    E1 --> E3[Workers]
    E1 --> E4[Place / rent]
    E2 --> E5[(Save monthly costs)]
    E3 --> E5
    E4 --> E5

    %% DASHBOARD
    DASH --> A1{Owner PIN correct?}
    A1 -- No --> HOME
    A1 -- Yes --> A2[Sales, profit, stock value, debts owed, costs]
```

## 2. How the numbers are calculated (so nothing is checked by hand)

```mermaid
flowchart LR
    SALES[Total sales] --> PROFIT
    COGS[Buy price x amount sold] --> PROFIT
    COSTS[Monthly costs: electricity + workers + place] --> NET
    PROFIT[Gross profit = sales - buy cost] --> NET[Net profit = gross profit - monthly costs]
    DEBTS[Money clients still owe] --> CASH[Cash really received = sales - debts]
```

## 3. Data (what SQLite will hold)

| Table | Holds |
|---|---|
| items | name, unit, buy price, default selling price |
| stock_in | item, amount received, buy price at that time, date |
| clients | name, phone (optional) |
| sales | client, date, total, paid, remaining debt |
| sale_lines | sale, item, amount, selling price used, buy price at that time |
| payments | sale or client, amount, date (debt payments) |
| expenses | month, type (electricity / workers / place), amount, note |
| settings | owner PIN (hashed) |

Stock on hand is never typed in directly. It is always `stock_in - sold`, so it can't drift out of sync over the years.

## 4. Decisions (answered by owner)
1. Buy price changes per delivery. Each delivery stores its own price; the app uses it for profit.
2. Workers: one total per month.
3. Currency: IQD only (whole numbers, no decimals).
4. Dashboard lock: PIN.
5. Sales (and stock entries, debt payments, costs) can be edited or cancelled at any time. Stock, debts and profit recalculate automatically. Every change is kept in a history log so nothing is lost.
6. Languages: Kurdish (Sorani) and Arabic only. The app is right-to-left, with a language switch.

7. Units are user-defined: the owner adds his own units (kg, box, ...) in Settings and picks one per item.
8. Categories are user-defined and permanent. Each item belongs to one category (e.g. Olives, Oil, Jars). Categories show as chips/tabs in Stock and Sell, and combine with search.
9. Default language: Kurdish (Sorani).

### Item entry with categories
```mermaid
flowchart LR
    N[New item] --> C[Pick category or add new]
    C --> NM[Name]
    NM --> U[Pick unit or add new]
    U --> P[Buy price + default selling price]
    P --> SV[(Save)]
```

### Finding items fast (Stock and Sell screens)
Category chips on top, then a search box, then recently sold items first. Search matches the item name inside the chosen category.

## 5. Still open
- Nothing blocking. UI mockups are next.
