# TallyPrime integration notes

> **How this document was produced.** These notes were gathered by an agent from
> public sources (search results, vendor help-site excerpts, a public Postman
> collection and community reference implementations). **The official
> TallyPrime help site was not reachable from the sandbox this research ran in**,
> and the Postman workspace itself was blocked by the network proxy, so several
> examples are reconstructed rather than copied from a live page.
>
> **Every XML example here must be verified against the office TallyPrime**
> before it is trusted in production. Where the middleware had to choose between
> conflicting shapes, the choice is recorded in
> [`middleware/README.md`](../middleware/README.md) under "Deviations from the
> plan", and the remaining uncertainties are listed there under "Open questions
> for the office Tally". Section 12 below lists what the research itself could
> not verify.
>
> The middleware's `FakeTallyTransport` (`middleware/talai_middleware/tally/fake.py`)
> is built to match these notes, so correcting a fact here means correcting the
> fake and its tests too.

---

## Research notes

## 1. Enabling Tally as an HTTP/XML Server

### Configuration Path
- **Location**: F1 (Help) → Settings → Advanced Configuration
- **Source**: [XML Integration - TallyHelp](https://help.tallysolutions.com/xml-integration/)

### HTTP Server Settings
- **Default Port**: 9000
- **Enablement**: Can be enabled via Settings → Advanced Configuration
- **Endpoint**: External applications post XML to `http://<Tally-IP>:9000`
- **Source**: [XML Integration - TallyHelp](https://help.tallysolutions.com/xml-integration/)

### ODBC Server (Optional)
- **Purpose**: Not mandatory for XML integration; mandatory only for ODBC data fetching
- **Default Port**: 9000 (can be changed if occupied)
- **Usage**: TallyPrime can act as both ODBC Server and ODBC Client
- **Source**: [ODBC Integrations | TallyHelp](https://help.tallysolutions.com/odbc-integrations/)

### TallyPrime Gold License (Multi-User LAN)
- **Architecture**: Gold license allows multiple users in same LAN to share a license
- **License Server**: TallyPrime License Server required on system where license is activated
- **Port for Gateway**: Tally Gateway Server (used for TallyPrime Server deployment) runs on port 9090
- **XML Port Sharing**: The HTTP/XML server on port 9000 is shared across LAN users; not a separate port per user
- **Multi-Subnet**: Different Tally Gateway Servers can run on different ports for different subnets
- **Source**: [How to Deploy an Existing Gold License with One TallyPrime Server | TallyHelp](https://help.tallysolutions.com/tally-prime-server/deployment-scenarios/existing-gold-license-with-one-server/), [How to Deploy Multiple Gold Licenses in a Subnet with One TallyPrime Server | TallyHelp](https://help.tallysolutions.com/tally-prime-server/deployment-scenarios/multiple-gold-licenses-in-a-subnet-with-one-server/)

### Critical Prerequisite
- **At least one company must be loaded** in TallyPrime before sending XML requests
- **Source**: [Integration With TallyPrime | TallyHelp](https://help.tallysolutions.com/integrate-with-tallyprime/)

---

## 2. XML Request Envelope Structure

### Old Format (Legacy)
```xml
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export Data|Import Data|Execute</TALLYREQUEST>
    ...
  </HEADER>
  <BODY>
    ...
  </BODY>
</ENVELOPE>
```

### Current Format (VERSION 1)
```xml
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export|Import|Execute</TALLYREQUEST>
    <TYPE>Collection|Object|Data|Report|Function</TYPE>
    <SUBTYPE>Optional</SUBTYPE>
    <ID>IdentifierName</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <!-- Global variables like SVCURRENTCOMPANY, SVFROMDATE, SVTODATE -->
      </STATICVARIABLES>
      <REPEATVARIABLES>
        <!-- Optional repeat variables -->
      </REPEATVARIABLES>
      <FETCHLIST>
        <!-- Fetch specifications for Collections/Objects -->
      </FETCHLIST>
      <FUNCPARAMLIST>
        <!-- Parameter specification for Function type -->
      </FUNCPARAMLIST>
      <TDL>
        <!-- TDL Information if applicable -->
      </TDL>
    </DESC>
    <DATA>
      <!-- Data for Import operations (if applicable) -->
    </DATA>
  </BODY>
</ENVELOPE>
```

### Key Header Elements
| Element | Required | Description |
|---------|----------|-------------|
| VERSION | Yes | Version number (currently 1) |
| TALLYREQUEST | Yes | Export, Import, or Execute |
| TYPE | Yes (for Export) | Collection, Object, Data, Report, Function |
| ID | Yes | Name of Collection, Object, Report, or Function |
| SUBTYPE | No | Optional, used where applicable |

### Response Format (Success)
```xml
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <STATUS>1</STATUS>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>...</STATICVARIABLES>
    </DESC>
    <DATA>
      <!-- Exported data -->
    </DATA>
  </BODY>
</ENVELOPE>
```

### Response Format (Failure)
```xml
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <STATUS>0</STATUS>
  </HEADER>
  <BODY>
    <DATA>
      <STATUS.LIST>
        <STATUS>
          <CODE>ErrorCode</CODE>
          <DESC>Error Description</DESC>
        </STATUS>
      </STATUS.LIST>
    </DATA>
  </BODY>
</ENVELOPE>
```

### Status Codes
- **STATUS = 1**: Success
- **STATUS = 0**: Failure
- **Source**: [XML Integration - TallyHelp](https://help.tallysolutions.com/xml-integration/), [Understanding Tally XML Tags | TallyHelp](https://help.tallysolutions.com/understanding-tally-xml-tags/)

---

## 3. Working XML Examples for Export Operations

### 3a. List of Currently Open Companies
```xml
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>Company</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <!-- Optional: empty or with filters -->
      </STATICVARIABLES>
      <FETCHLIST>
        <FETCH>NAME</FETCH>
        <FETCH>COMPANYID</FETCH>
      </FETCHLIST>
    </DESC>
  </BODY>
</ENVELOPE>
```

**Response Contains**: `<REMOTECOMPANY>` tag repeating for each accessible company with NAME and COMPANYID

**Source**: [Getting List of Companies | TallyHelp](https://help.tallysolutions.com/developer-reference/tally-authentication-library/xml-requests-and-responses-for-each-step/)

### 3b. List of Ledgers with Parent Group & Closing Balance
```xml
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>Ledger</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <!-- Can include SVCURRENTCOMPANY to filter by company -->
      </STATICVARIABLES>
      <FETCHLIST>
        <FETCH>NAME</FETCH>
        <FETCH>PARENT</FETCH>
        <FETCH>CLOSINGBALANCE</FETCH>
        <FETCH>MASTERID</FETCH>
      </FETCHLIST>
    </DESC>
  </BODY>
</ENVELOPE>
```

**Fields Available**:
- NAME: Ledger name
- PARENT: Parent group name
- CLOSINGBALANCE: Balance as of reporting date
- MASTERID: Unique Tally ID for the ledger

**Source**: [Sample XML | TallyHelp](https://help.tallysolutions.com/sample-xml/)

### 3c. List of Groups
```xml
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>Group</ID>
  </HEADER>
  <BODY>
    <DESC>
      <FETCHLIST>
        <FETCH>NAME</FETCH>
        <FETCH>PARENT</FETCH>
        <FETCH>MASTERID</FETCH>
        <FETCH>CHILDCOUNT</FETCH>
      </FETCHLIST>
    </DESC>
  </BODY>
</ENVELOPE>
```

**Source**: [Understanding Tally XML Tags | TallyHelp](https://help.tallysolutions.com/understanding-tally-xml-tags/)

### 3d. List of Stock Items (Inventory Masters)
```xml
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>StockItem</ID>
  </HEADER>
  <BODY>
    <DESC>
      <FETCHLIST>
        <FETCH>NAME</FETCH>
        <FETCH>BASEUNITS</FETCH>
        <FETCH>CATEGORY</FETCH>
        <FETCH>OPENINGBALANCE</FETCH>
        <FETCH>RATE</FETCH>
      </FETCHLIST>
    </DESC>
  </BODY>
</ENVELOPE>
```

### 3e. List of Cost Centres
```xml
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>CostCentre</ID>
  </HEADER>
  <BODY>
    <DESC>
      <FETCHLIST>
        <FETCH>NAME</FETCH>
        <FETCH>MASTERID</FETCH>
      </FETCHLIST>
    </DESC>
  </BODY>
</ENVELOPE>
```

**Source**: [How to Create Cost Centre in TallyPrime | TallyHelp](https://help.tallysolutions.com/cost-centre-or-profit-centre-tally/)

### 3f. List of Voucher Types
```xml
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>VoucherType</ID>
  </HEADER>
  <BODY>
    <DESC>
      <FETCHLIST>
        <FETCH>NAME</FETCH>
        <FETCH>MASTERID</FETCH>
      </FETCHLIST>
    </DESC>
  </BODY>
</ENVELOPE>
```

### 3g. Day Book / Vouchers for Date Range
```xml
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>Voucher</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>CompanyName</SVCURRENTCOMPANY>
        <SVFROMDATE>20240101</SVFROMDATE>
        <SVTODATE>20240131</SVTODATE>
      </STATICVARIABLES>
      <FETCHLIST>
        <FETCH>DATE</FETCH>
        <FETCH>VOUCHERNUMBER</FETCH>
        <FETCH>VOUCHERTYPENAME</FETCH>
        <FETCH>ALLLEDGERENTRIES.LIST</FETCH>
      </FETCHLIST>
    </DESC>
  </BODY>
</ENVELOPE>
```

**Variables**:
- SVCURRENTCOMPANY: Name of company to filter vouchers
- SVFROMDATE: Start date (YYYYMMDD format)
- SVTODATE: End date (YYYYMMDD format)

**Source**: [Understanding Integration - Reports | TallyHelp](https://help.tallysolutions.com/developer-reference/introduction/understanding-integration-reports/), [Sample XML | TallyHelp](https://help.tallysolutions.com/sample-xml/)

### 3h. Trial Balance / Profit & Loss / Balance Sheet Reports
```xml
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Report</TYPE>
    <ID>Trial Balance</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>CompanyName</SVCURRENTCOMPANY>
        <SVFROMDATE>20240101</SVFROMDATE>
        <SVTODATE>20240131</SVTODATE>
      </STATICVARIABLES>
    </DESC>
  </BODY>
</ENVELOPE>
```

**Alternative Report Names**:
- "Trial Balance"
- "Profit and Loss A/c" (or "Profit & Loss Account")
- "Balance Sheet"
- "Bills Receivable"
- "Bills Payable"

**Accessibility**: Export menu available only to users with access rights to Balance Sheet, Profit & Loss, and Trial Balance reports.

**Export Format**: Available in XML, Excel, PDF, and Data Interchange formats (Data Exchange).

**Source**: [Financial Statements for NCE - FAQ | TallyHelp](https://help.tallysolutions.com/tally-prime/gst-master-setup/india-gst-update-party-gstin-uin-tally/), [How to Export Data in TallyPrime | TallyHelp](https://help.tallysolutions.com/export-data-in-tally/)

### 3i. Outstanding Bills / Ageing (Bills Receivable / Bills Payable)
```xml
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Report</TYPE>
    <ID>Bills Receivable</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>CompanyName</SVCURRENTCOMPANY>
      </STATICVARIABLES>
    </DESC>
  </BODY>
</ENVELOPE>
```

**Features**:
- Ageing by Bill Date: Age calculated from invoice creation date
- Ageing by Due Date: Age calculated from due date (after credit days)
- Partial payments tracked through bill allocation
- Collection name: BILLALLOCATIONS contains allocation details

**Source**: [How to Manage Outstanding Receivables in TallyPrime | TallyHelp](https://help.tallysolutions.com/tally-prime/accounting-financial-reports/manage-receivables-outstanding-tally/), [How to Manage Outstanding Payables in TallyPrime | TallyHelp](https://help.tallysolutions.com/manage-outstanding-payables-tally/)

---

## 4. Working XML for Import (Write Operations)

### 4a. Creating a Ledger with Parent Group, GSTIN, and Address
```xml
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Import</TALLYREQUEST>
  </HEADER>
  <BODY>
    <TALLYMESSAGE>
      <LEDGER NAME="Customer ABC" ACTION="Create">
        <PARENT>Sundry Debtors</PARENT>
        <LEDGERNAME>Customer ABC</LEDGERNAME>
        <LEDGERTYPE>Customer</LEDGERTYPE>
        <GSTAPPLICABLE>Yes</GSTAPPLICABLE>
        <GSTIN>22AABCT1234H1Z0</GSTIN>
        <ADDRESS>
          <ADDRESS.LIST NAME="Address1">
            <ADDRESS1>123 Main Street</ADDRESS1>
            <ADDRESS2>Suite 100</ADDRESS2>
            <CITY>Delhi</CITY>
            <STATE>DL</STATE>
            <PINCODE>110001</PINCODE>
            <COUNTRY>India</COUNTRY>
          </ADDRESS.LIST>
        </ADDRESS>
        <EMAIL>customer@example.com</EMAIL>
        <PHONE>9876543210</PHONE>
        <OPENINGBALANCE>0.00</OPENINGBALANCE>
        <OPENINGBALANCEPERIOD>0</OPENINGBALANCEPERIOD>
      </LEDGER>
    </TALLYMESSAGE>
  </BODY>
</ENVELOPE>
```

**Key Fields**:
- ACTION: "Create" (for new ledger) or "Alter" (for existing)
- PARENT: Must match an existing group name (e.g., "Sundry Debtors", "Sundry Creditors", "Bank Accounts")
- GSTIN: Must be 15-character GST number
- ADDRESS: Location details required for GSTIN to display
- GSTAPPLICABLE: "Yes" or "No"

**Source**: [How to Create Party Ledgers for GST in TallyPrime | TallyHelp](https://help.tallysolutions.com/india-gst-creating-party-ledgers-for-gst-tally/), [How to Update Party GSTIN/UIN in TallyPrime | TallyHelp](https://help.tallysolutions.com/tally-prime/gst-master-setup/india-gst-update-party-gstin-uin-tally/)

### 4b. Creating a Purchase Voucher with Multiple Entries
```xml
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Import</TALLYREQUEST>
  </HEADER>
  <BODY>
    <TALLYMESSAGE>
      <VOUCHER VCHTYPE="Purchase" ACTION="Create">
        <DATE>20240115</DATE>
        <REFERENCE>PO-2024-001</REFERENCE>
        <VOUCHERNUMBER>1</VOUCHERNUMBER>
        <PARTYNAME>Supplier XYZ</PARTYNAME>
        <NARRATION>Purchase of goods</NARRATION>
        <REMOTEID>EXT-PUR-001</REMOTEID>
        
        <!-- Ledger Entries (Accounting) -->
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>Supplier XYZ</LEDGERNAME>
          <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
          <AMOUNT>10000.00</AMOUNT>
          <BILLALLOCATIONS.LIST>
            <NAME>INV-2024-001</NAME>
            <BILLTYPE>New Ref</BILLTYPE>
            <AMOUNT>10000.00</AMOUNT>
          </BILLALLOCATIONS.LIST>
        </ALLLEDGERENTRIES.LIST>
        
        <!-- Purchase Account Entry (opposite sign) -->
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>Purchase</LEDGERNAME>
          <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
          <AMOUNT>-8000.00</AMOUNT>
          <TAXRATE>5</TAXRATE>
        </ALLLEDGERENTRIES.LIST>
        
        <!-- Tax Ledger Entry (GST) -->
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>IGST Input</LEDGERNAME>
          <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
          <AMOUNT>-400.00</AMOUNT>
        </ALLLEDGERENTRIES.LIST>
        
        <!-- Inventory Entries (Goods) -->
        <INVENTORYENTRIES.LIST>
          <STOCKITEMNAME>Material A</STOCKITEMNAME>
          <RATE>100.00</RATE>
          <AMOUNT>8000.00</AMOUNT>
          <ACTUALQTY>80.00</ACTUALQTY>
          <BILLEDQTY>80.00</BILLEDQTY>
          <GODOWNNAME>Warehouse 1</GODOWNNAME>
          <BATCHALLOCATIONS.LIST>
            <BATCHNAME>BATCH-2024-01</BATCHNAME>
            <BATCHQUANTITY>80.00</BATCHQUANTITY>
            <BATHLEVEL>Primary</BATHLEVEL>
          </BATCHALLOCATIONS.LIST>
        </INVENTORYENTRIES.LIST>
        
        <!-- Cost Centre Allocation -->
        <COSTCENTREALLOCATIONS.LIST>
          <LEDGERNAME>Purchase</LEDGERNAME>
          <COSTCENTRENAME>Project X</COSTCENTRENAME>
          <AMOUNT>8000.00</AMOUNT>
        </COSTCENTREALLOCATIONS.LIST>
      </VOUCHER>
    </TALLYMESSAGE>
  </BODY>
</ENVELOPE>
```

### 4c. Sign Convention for Ledger Entries

**Critical**: The sign convention in TallyPrime XML is counter-intuitive:

| ISDEEMEDPOSITIVE | Amount Sign | Accounting Meaning | Example |
|------------------|-------------|-------------------|---------|
| Yes | Negative (e.g., -10000) | Debit (outflow from account) | Bank account withdrawal, Asset increase |
| No | Positive (e.g., 11800) | Credit (inflow to account) | Income received, Liability increase |

**Example**:
- Bank receives payment from customer: Bank ledger with `ISDEEMEDPOSITIVE="Yes"` and `AMOUNT="-10000"` (customer owes less)
- Income recorded: Income ledger with `ISDEEMEDPOSITIVE="No"` and `AMOUNT="10000"` (income increases)

**Source**: [Standard Tally XML Tags for Sales Vouchers: Integration Rules | TrulyInvoice](https://www.trulyinvoice.com/blog/standard-tally-xml-tags-for-sales-vouchers)

### 4d. Bill Allocations (BILLALLOCATIONS.LIST)
```xml
<BILLALLOCATIONS.LIST>
  <NAME>Reference Name (e.g., INV-2024-001)</NAME>
  <BILLTYPE>New Ref|Agst Ref|On Account</BILLTYPE>
  <AMOUNT>1000.00</AMOUNT>
</BILLALLOCATIONS.LIST>
```

**BILLTYPE Options**:
- **New Ref**: New bill reference (new invoice being referenced)
- **Agst Ref**: Against Reference (payment against existing bill)
- **On Account**: On account payment

### 4e. Idempotency and Preventing Duplicates

**Using REMOTEID**:
```xml
<VOUCHER VCHTYPE="Purchase" ACTION="Create">
  <REMOTEID>UNIQUE_EXTERNAL_ID_12345</REMOTEID>
  ...
</VOUCHER>
```

**Using VOUCHERKEY** (Alternative):
- Combination of DATE + VOUCHERTYPENAME + VOUCHERNUMBER must be unique
- If resubmitting with same key, use ACTION="Alter" instead of "Create"

**ACTION Values**:
- **Create**: New object (will fail if REMOTEID already exists)
- **Alter**: Modify existing object (use REMOTEID or VOUCHERKEY to identify)
- **Delete**: Remove object

**Best Practice**: Always include REMOTEID or VOUCHERKEY to enable idempotent operations and prevent duplicates on retry.

**Source**: [How to Mark the Modified Vouchers in TallyPrime and Share with Your Clients | TallyHelp](https://help.tallysolutions.com/mark-changed-vouchers-tally/)

---

## 5. Response Format for Import Operations

### Import Response Structure
```xml
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <STATUS>1</STATUS>
  </HEADER>
  <BODY>
    <IMPORTRESULT>
      <CREATED>5</CREATED>
      <ALTERED>2</ALTERED>
      <DELETED>0</DELETED>
      <COMBINED>0</COMBINED>
      <IGNORED>0</IGNORED>
      <ERRORS>1</ERRORS>
      <LINEERROR>
        <LINE>1</LINE>
        <DESC>Voucher totals do not match! Dr: 20,394.00 Cr: 20,395.00 Diff: 1.00 Cr</DESC>
      </LINEERROR>
      <LINEERROR>
        <LINE>5</LINE>
        <DESC>Could not find Ledger: NonExistentLedger</DESC>
      </LINEERROR>
    </IMPORTRESULT>
  </BODY>
</ENVELOPE>
```

### Common Error Messages
| Error | Cause | Resolution |
|-------|-------|-----------|
| "Voucher totals do not tally" | Debit total ≠ Credit total | Balance all ledger entries; check ISDEEMEDPOSITIVE and AMOUNT signs |
| "Could not find Ledger: LedgerName" | Referenced ledger doesn't exist | Create the ledger first; ensure correct parent group |
| "Could not find StockItem: ItemName" | Referenced stock item not found | Create stock item before using in INVENTORYENTRIES |
| "Uploaded XML Structure is not Valid" | Malformed XML | Verify XML syntax, check for unclosed tags, validate encoding |
| Company not loaded | No company open when request received | Load company in TallyPrime before sending requests |
| Unknown Request | Invalid TALLYREQUEST or TYPE value | Use valid values: Export/Import/Execute for TALLYREQUEST |

**Source**: [Case Study 1 - XML Request and Response Formats | TallyHelp](https://help.tallysolutions.com/article/DeveloperReference/integration-capabilities/case_study_1.htm), [Sample XML | TallyHelp](https://help.tallysolutions.com/sample-xml/)

### HTTP Status Behavior
- TallyPrime primarily uses internal `<STATUS>` tags (0 = failure, 1 = success) in XML responses
- Response codes (200, 400, 500) follow HTTP standard behaviors
- Ensure HTTP endpoint is properly configured to handle responses
- **Source**: [Integration With TallyPrime | TallyHelp](https://help.tallysolutions.com/developer-reference/introduction/integration-with-tallyprime/)

---

## 6. Encoding and Character Handling

### Supported Encodings
- **Default**: UTF-8
- **Alternative**: UTF-16 (supports extended characters like currency symbols)
- **HTTP Content-Type**: Accept `text/xml; charset=utf-8` and `text/xml; charset=utf-16`

**Recommendation**: Use UTF-8 for ASCII-compatible content; UTF-16 for special characters (Rupee ₹, Euro €, etc.)

**Source**: [Specifying special characters in XML request - TallyHelp](https://help.tallysolutions.com/article/DeveloperReference/faq/9228.html)

### Special Character Escaping
| Character | Escaped Form |
|-----------|--------------|
| & | &amp; |
| < | &lt; |
| > | &gt; |
| " | &quot; |
| ' | &apos; |

**Example**: "A & B Enterprises" → "A &amp; B Enterprises"

**Source**: [Fix Tally XML & Excel Import Errors | TrulyInvoice](https://www.trulyinvoice.com/blog/resolve-tally-excel-xml-import-errors)

### Control Characters
- UTF-16 supports control characters (e.g., &#4;) for special formatting
- Not commonly used in standard business data import/export
- Ensure XML is well-formed; most parsers reject invalid control characters
- **Status**: Limited documentation on control character usage patterns; verify with specific use cases

---

## 7. Rate Limits, Concurrency, and Performance

### Concurrency Model
- **TallyPrime Server**: Multi-threaded architecture; requests from every user get equal priority and are solved in parallel
- **Desktop TallyPrime**: Single instance receives XML requests sequentially on port 9000
- **State Management**: TallyPrime File System includes State Files for concurrency control and exclusivity

**Source**: [Frequently Asked Questions (FAQs) on TallyPrime Server | TallyHelp](https://help.tallysolutions.com/tally-prime-server/tally-prime-server-faq/)

### UI Blocking Behavior
- **Write Operations**: May block UI for LAN users if they are viewing the same masters/vouchers being modified
- **Read Operations**: Typically non-blocking
- **Recommendation**: Batch writes during off-peak hours or use TallyPrime Server for concurrent access

### Best Practices (Limitations Not Explicitly Documented)
- **Batch Size**: No official limit documented; recommend testing with 10-50 vouchers per batch
- **Timeout**: Use standard HTTP timeouts (30-60 seconds); adjust based on batch size and network latency
- **Rate Limiting**: No rate limits documented; TallyPrime is designed for business users, not high-frequency API access
- **Polling**: For incremental sync, poll every 5-15 minutes to avoid excessive server load

**Note**: Official documentation does not specify exact rate limits, batch sizes, or timeout recommendations. These are inference-based best practices.

**Source**: [Checklist for Troubleshooting Performance Issues of TallyPrime | TallyHelp](https://help.tallysolutions.com/tally-prime/connected-services/checklist-for-troubleshooting-performance-issues-of-tallyprime/), [Frequently Asked Questions (FAQs) on TallyPrime Server | TallyHelp](https://help.tallysolutions.com/tally-prime-server/tally-prime-server-faq/)

---

## 8. Incremental Sync and Change Detection

### Change Tracking Fields

#### ALTERID (Alteration ID)
- Assigned by TallyPrime when any object is created or modified
- Increments on every alteration (including back-dated vouchers)
- Unique within a company
- Useful for detecting changes since last sync
- **Usage**: Query ledgers/vouchers modified after a specific ALTERID

**Source**: [FAQs on Synchronisation in TallyPrime | TallyHelp](https://help.tallysolutions.com/synchronisation-faq-tally/)

#### GUID (Global Unique Identifier)
- 16-byte unique identifier assigned to each Company
- Prevents duplicate companies during synchronization
- Must be unique across all systems
- **Usage**: Identify companies uniquely across remote systems

**Source**: [FAQs on Synchronisation in TallyPrime | TallyHelp](https://help.tallysolutions.com/synchronisation-faq-tally/)

#### MASTERID
- Unique numeric ID for each master (ledger, voucher, group, etc.)
- Assigned by TallyPrime
- Can be used to identify objects in export queries

### Incremental Sync Pattern
```xml
<!-- Query for ledgers modified since last sync (using SVFROMDATE filter) -->
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>Ledger</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>YourCompany</SVCURRENTCOMPANY>
        <SVFROMDATE>20240101</SVFROMDATE>
        <!-- Date represents "last sync date"; only modified ledgers returned -->
      </STATICVARIABLES>
      <FETCHLIST>
        <FETCH>NAME</FETCH>
        <FETCH>ALTERID</FETCH>
        <FETCH>MASTERID</FETCH>
      </FETCHLIST>
    </DESC>
  </BODY>
</ENVELOPE>
```

### Synchronization Architecture (TallyPrime Server)
- **CID** (Creation ID): Creation ID value maintained per company pair
- **AID** (Alteration ID): Alteration ID value maintained per company pair
- **Sync Rule**: Client sends previous CID/AID values to Server
- **Delta Detection**: Server checks if CID/AID are latest; if not, sends only changed objects
- **Remote Fields**: RemoteGUID, RemoteAlterID, RemoteAltGUID track changes across systems

**Source**: [FAQs on Synchronisation in TallyPrime | TallyHelp](https://help.tallysolutions.com/synchronisation-faq-tally/), [How to Exchange Data Between Branches: Data Synchronisation in TallyPrime | TallyHelp](https://help.tallysolutions.com/data-synchronisation-tally/)

### Recommended Incremental Sync Strategy
1. **Store last ALTERID** or **last modified date** per collection
2. **Query with SVFROMDATE** filter for vouchers, or export ALTERID field for all objects
3. **Compare ALTERID values** between syncs to detect changes
4. **On first sync**: Export all with MASTERID tracking
5. **On subsequent syncs**: Only fetch objects with ALTERID > last known ALTERID

---

## 9. Official REST/JSON Alternatives

### TallyPrime 7.0+ Native JSON Support
- **Native Format**: JSON data structure matching Tally's internal object schema
- **Direct Consumption**: Can be posted directly to TallyPrime without TDL coding
- **Endpoint**: Same HTTP/port 9000, with JSON payloads instead of XML
- **Import**: JSON files can be imported via Import feature or HTTP POST from external API
- **Export**: Collections and reports can be exported in native JSON format

**Source**: [How to Integrate with TallyPrime Using JSON | TallyHelp](https://help.tallysolutions.com/tally-prime-integration-using-json-1/), [Release Notes for TallyPrime Developer Release 7.0/7.1 | TallyHelp](https://help.tallysolutions.com/release-notes-tally-prime-developer-7/)

### Integration Methods (Tally Solutions Official)
- **XML over HTTP**: Legacy, widely supported
- **JSON over HTTP**: Native in TallyPrime 7.0+
- **ODBC**: For data extraction (read-only for most databases)
- **REST APIs**: Limited; depends on custom TDL development
- **TDL-based Integration**: Custom coding required for advanced scenarios

**Source**: [Integration Methods and Technologies | TallyHelp](https://help.tallysolutions.com/integration-methods-and-technologies/)

### REST API Status
- **No Official REST API** from Tally Solutions for standard operations
- **Custom Development**: REST endpoints can be created using TDL if needed
- **Alternative**: JSON over HTTP is the modern approach (TallyPrime 7.0+)
- **TallyPrime Server**: Enterprise deployment with programmatic access capabilities

**Source**: [Integration Methods and Technologies | TallyHelp](https://help.tallysolutions.com/integration-methods-and-technologies/), [Seamless Tally Integration Solutions | TallyPrime](https://tallysolutions.com/integration/)

### ODBC on Linux/Mac
- **Native ODBC**: Available on Windows only
- **Linux Access**: Via TallyPrime Cloud Access (browser-based) or Wine layer (unsupported)
- **Mac Access**: Via TallyPrime Cloud Access (browser-based)
- **Cloud Alternative**: Use TallyPrime Cloud Access hosted on Oracle Cloud Infrastructure (OCI) for cross-platform access
- **ODBC over Network**: ODBC Server on Windows machine can serve Linux/Mac clients via network (limited support)

**Source**: [Recommended System Configurations for TallyPrime | TallyHelp](https://help.tallysolutions.com/tally-prime/quick-start-guide/recommended-system-configuration-for-tallyprime/), [FAQ for TallyPrime Cloud Access | TallyHelp](https://help.tallysolutions.com/tallyprime-cloud-access-faq/)

---

## 10. Summary of Key Integration Points

| Feature | Details | Source |
|---------|---------|--------|
| **HTTP Server Port** | 9000 (default, configurable) | XML Integration - TallyHelp |
| **Enable Path** | F1 → Settings → Advanced Configuration | XML Integration - TallyHelp |
| **Prerequisite** | At least one company must be open | Integration With TallyPrime |
| **XML Format** | ENVELOPE with HEADER/BODY structure | Understanding Tally XML Tags |
| **Response Status** | 1 = success, 0 = failure | Case Study 1 |
| **Date Format** | YYYYMMDD (all dates) | Sample XML |
| **Encoding** | UTF-8 (default) or UTF-16 | Specifying special characters in XML |
| **Sign Convention** | ISDEEMEDPOSITIVE="Yes" = negative amount (debit) | Standard Tally XML Tags |
| **Change Tracking** | ALTERID field for incremental sync | Synchronisation FAQ |
| **Multi-User Gold** | XML port 9000 shared across LAN clients | TallyPrime Server deployment docs |
| **JSON Support** | Native in TallyPrime 7.0+ | JSON Integration - TallyHelp |
| **Cloud Access** | TallyPrime Cloud on Oracle OCI | TallyPrime Cloud Access FAQ |

---

## 11. Postman Collection: interstellar-space-164542/tallyprime

### Workspace Overview
- **URL**: https://www.postman.com/interstellar-space-164542/tallyprime/
- **Type**: Public Postman workspace/collection for TallyPrime XML integration
- **Source**: [TallyPrime | Postman API Network](https://www.postman.com/interstellar-space-164542/tallyprime/overview)
- **Documentation**: Also available at https://documenter.getpostman.com/view/13855108/TzeRpAMt

### Available Requests (Verified from Web Search)

The workspace includes the following requests:

#### Export (Read) Operations

**1. List of Companies**
- **Method**: POST
- **Port**: 9000
- **XML Structure**:
```xml
<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE>
  <ID>List of Companies</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
   </STATICVARIABLES>
   <TDL>
    <TDLMESSAGE>
     <COLLECTION NAME="List of Companies" ISMODIFY="No">
      <TYPE>Company</TYPE>
      <NATIVEMETHOD>Name</NATIVEMETHOD>
      <NATIVEMETHOD>StartingFrom</NATIVEMETHOD>
      <NATIVEMETHOD>BooksFrom</NATIVEMETHOD>
     </COLLECTION>
    </TDLMESSAGE>
   </TDL>
  </DESC>
 </BODY>
</ENVELOPE>
```
- **Postman URL**: [List of companies | TallyPrime](https://www.postman.com/interstellar-space-164542/tallyprime/request/8840596-ee4c135d-3864-4ec0-9307-19025d9ea4c3)

**2. Current Company**
- **Method**: POST
- **Port**: 9000
- **Purpose**: Get details of currently active company
- **Postman URL**: [Current Company | TallyPrime](https://www.postman.com/interstellar-space-164542/workspace/tallyprime/request/8840596-67279fcf-7544-49f9-947f-866578ede2c2)

**3. Ledger (Collection Export)**
- **Method**: POST
- **Port**: 9000
- **XML Structure**:
```xml
<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE>
  <ID>LedColl</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    <SVCURRENTCOMPANY>YOUR COMPANY NAME</SVCURRENTCOMPANY>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
   </STATICVARIABLES>
   <TDL>
    <TDLMESSAGE>
     <COLLECTION NAME="Ledger">
      <TYPE>Ledger</TYPE>
      <NATIVEMETHOD>Name</NATIVEMETHOD>
      <NATIVEMETHOD>Parent</NATIVEMETHOD>
      <NATIVEMETHOD>OpeningBalance</NATIVEMETHOD>
      <NATIVEMETHOD>ClosingBalance</NATIVEMETHOD>
     </COLLECTION>
    </TDLMESSAGE>
   </TDL>
  </DESC>
 </BODY>
</ENVELOPE>
```
- **Fields**: Name, Parent, OpeningBalance, ClosingBalance
- **Postman URL**: [Ledger | TallyXML | Postman API Network](https://www.postman.com/interstellar-space-164542/tallyprime/request/n500e2x/ledger)

**4. Group (Collection Export)**
- **Method**: POST
- **Port**: 9000
- **Purpose**: Export all groups with hierarchy information
- **Postman URL**: [Group | TallyPrime](https://www.postman.com/interstellar-space-164542/workspace/tallyprime/request/8840596-bcdfd001-aff7-4a94-8d4a-94135b929a09)

**5. StockItem_ByMasterID**
- **Method**: POST
- **Port**: 9000
- **Purpose**: Retrieve stock items by their Master ID
- **Postman URL**: [StockItem_ByMasterID | TallyPrime](https://www.postman.com/interstellar-space-164542/workspace/tallyprime/request/8840596-8bfbd7d9-4a06-43e5-afdf-0a017f693e99)

**6. Voucher Register (Day Book)**
- **Method**: POST
- **Port**: 9000
- **XML Structure**:
```xml
<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Data</TYPE>
  <ID>Voucher Register</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    <SVCURRENTCOMPANY>YOUR COMPANY NAME</SVCURRENTCOMPANY>
    <SVFROMDATE TYPE="Date">20250401</SVFROMDATE>
    <SVTODATE TYPE="Date">20260331</SVTODATE>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
   </STATICVARIABLES>
  </DESC>
 </BODY>
</ENVELOPE>
```
- **Note**: Date filter may be ignored; returns whole fiscal year. Re-filter results in code.
- **Postman URL**: [LedgerVouchers | TallyXML | Postman API Network](https://www.postman.com/interstellar-space-164542/tallyprime/request/66sr0s3/ledgervouchers)

**7. Voucher_ByVoucherNumber**
- **Method**: POST
- **Port**: 9000
- **Purpose**: Retrieve specific voucher by its number
- **Postman URL**: [Voucher_ByVoucherNumber | TallyXML](https://www.postman.com/interstellar-space-164542/tallyprime/request/cz7p2kf/voucher-byvouchernumber)

**8. Trial Balance**
- **Method**: POST
- **Port**: 9000
- **XML Structure**:
```xml
<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Data</TYPE>
  <ID>Trial Balance</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    <SVCURRENTCOMPANY>YOUR COMPANY NAME</SVCURRENTCOMPANY>
    <SVFROMDATE>20250401</SVFROMDATE>
    <SVTODATE>20260331</SVTODATE>
   </STATICVARIABLES>
  </DESC>
 </BODY>
</ENVELOPE>
```
- **Returns**: Ledger closing balances for specified fiscal period

**9. Profit and Loss (P&L)**
- **Method**: POST
- **Port**: 9000
- **XML Structure**:
```xml
<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Data</TYPE>
  <ID>Profit and Loss</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    <SVCURRENTCOMPANY>YOUR COMPANY NAME</SVCURRENTCOMPANY>
    <SVFROMDATE>20250401</SVFROMDATE>
    <SVTODATE>20260331</SVTODATE>
   </STATICVARIABLES>
  </DESC>
 </BODY>
</ENVELOPE>
```
- **Returns**: Sales, cost of sales, and direct/indirect expenses

#### Import (Write) Operations

**10. Create Ledger**
- **Method**: POST
- **Port**: 9000
- **XML Structure**:
```xml
<ENVELOPE>
 <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
 <BODY><IMPORTDATA>
  <REQUESTDESC><REPORTNAME>All Masters</REPORTNAME>
   <STATICVARIABLES><SVCURRENTCOMPANY>YOUR COMPANY NAME</SVCURRENTCOMPANY></STATICVARIABLES>
  </REQUESTDESC>
  <REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
   <LEDGER NAME="New Party Ledger" ACTION="Create">
    <NAME>New Party Ledger</NAME>
    <PARENT>Sundry Creditors</PARENT>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
   </LEDGER>
  </TALLYMESSAGE></REQUESTDATA>
 </IMPORTDATA></BODY>
</ENVELOPE>
```
- **Action Values**: `ACTION="Create"` for new, `ACTION="Alter"` for existing
- **Parent Examples**: Sundry Debtors, Sundry Creditors, Bank Accounts, etc.
- **Postman URL**: [Create Ledger | Tally](https://www.postman.com/interstellar-space-164542/tallyprime/request/aq7cwvp/create-ledger)

**11. Create Stock Item**
- **Method**: POST
- **Port**: 9000
- **XML Structure**:
```xml
<ENVELOPE>
 <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
 <BODY><IMPORTDATA>
  <REQUESTDESC><REPORTNAME>All Masters</REPORTNAME>
   <STATICVARIABLES><SVCURRENTCOMPANY>YOUR COMPANY NAME</SVCURRENTCOMPANY></STATICVARIABLES>
  </REQUESTDESC>
  <REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
   <STOCKITEM NAME="SAMPLESCRIP" ACTION="Create">
    <NAME>SAMPLESCRIP</NAME>
    <PARENT>Share Stock Investment</PARENT>
    <BASEUNITS>nos</BASEUNITS>
    <COSTINGMETHOD>FIFO Perpetual</COSTINGMETHOD>
    <VALUATIONMETHOD>Avg. Price</VALUATIONMETHOD>
   </STOCKITEM>
  </TALLYMESSAGE></REQUESTDATA>
 </IMPORTDATA></BODY>
</ENVELOPE>
```
- **Parent Group**: Must already exist in system
- **Base Units**: Must correspond to pre-existing measurement unit

**12. Import Receipt Voucher (Dividend)**
- **Method**: POST
- **Port**: 9000
- **XML Structure** (from example):
```xml
<ENVELOPE>
 <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
 <BODY><IMPORTDATA>
  <REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>
   <STATICVARIABLES><SVCURRENTCOMPANY>YOUR COMPANY NAME</SVCURRENTCOMPANY></STATICVARIABLES>
  </REQUESTDESC>
  <REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
   <VOUCHER VCHTYPE="Receipt" ACTION="Create">
    <DATE>20260330</DATE>
    <EFFECTIVEDATE>20260330</EFFECTIVEDATE>
    <NARRATION>Dividend from Investment Company</NARRATION>
    <ALLLEDGERENTRIES.LIST>
     <LEDGERNAME>Dividend Received</LEDGERNAME>
     <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
     <AMOUNT>24480.00</AMOUNT>
    </ALLLEDGERENTRIES.LIST>
    <ALLLEDGERENTRIES.LIST>
     <LEDGERNAME>Bank Account</LEDGERNAME>
     <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
     <AMOUNT>-24480.00</AMOUNT>
     <BANKALLOCATIONS.LIST>
      <TRANSACTIONTYPE>Inter Bank Transfer</TRANSACTIONTYPE>
      <AMOUNT>24480.00</AMOUNT>
      <DATE>20260330</DATE>
     </BANKALLOCATIONS.LIST>
    </ALLLEDGERENTRIES.LIST>
   </VOUCHER>
  </TALLYMESSAGE></REQUESTDATA>
 </IMPORTDATA></BODY>
</ENVELOPE>
```
- **Key Fields**: DATE, EFFECTIVEDATE, NARRATION, ALLLEDGERENTRIES.LIST, BANKALLOCATIONS.LIST
- **Amount Signs**: Credit transactions have positive amounts with `ISDEEMEDPOSITIVE="No"`

**13. Import Payment Voucher**
- **Method**: POST
- **Port**: 9000
- **REMOTEID**: Unique identifier (e.g., "DEMO-PAY-20260401-001")
- **VCHTYPE**: "Payment"
- **Structure**: Two ledger entries (expense account and bank account) with opposite amount signs
- **Submission**: POST to `http://localhost:9000` with `Content-Type: text/xml`

**14. Import Purchase Voucher (Invoice)**
- **Method**: POST
- **Port**: 9000
- **Features**:
  - `VCHTYPE="Purchase"` with `OBJVIEW="Invoice Voucher View"`
  - `ISINVOICE="Yes"` flag for inventory tracking
  - `ALLINVENTORYENTRIES.LIST` for stock items (negative AMOUNT for debits)
  - `LEDGERENTRIES.LIST` for party/supplier (positive AMOUNT for credits)
  - `ACCOUNTINGALLOCATIONS.LIST` linking inventory to accounts
  - Date fields: DATE and EFFECTIVEDATE
- **Amount Convention**: Negative amounts with `ISDEEMEDPOSITIVE="Yes"` for debits; positive with `ISDEEMEDPOSITIVE="No"` for credits

**15. Import Journal Voucher**
- **Method**: POST
- **Port**: 9000
- **VCHTYPE**: "Journal"
- **Purpose**: General journal entries (same structure as other vouchers)

**16. Import Contra Voucher**
- **Method**: POST
- **Port**: 9000
- **VCHTYPE**: "Contra"
- **Purpose**: Contra entries between bank and cash accounts

#### Delete Operations

**17. Delete Voucher**
- **Method**: POST
- **Port**: 9000
- **XML Structure**:
```xml
<ENVELOPE>
 <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
 <BODY><IMPORTDATA>
  <REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>
   <STATICVARIABLES><SVCURRENTCOMPANY>YOUR COMPANY NAME</SVCURRENTCOMPANY></STATICVARIABLES>
  </REQUESTDESC>
  <REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
   <VOUCHER REMOTEID="DEMO-PAY-20260401-001" VCHTYPE="Payment" ACTION="Delete">
    <DATE>20260401</DATE>
    <VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>
   </VOUCHER>
  </TALLYMESSAGE></REQUESTDATA>
 </IMPORTDATA></BODY>
</ENVELOPE>
```
- **ACTION**: `ACTION="Delete"`
- **REMOTEID**: Must match the ID assigned during creation
- **Requirement**: REMOTEID must have been assigned during creation; cannot delete by Tally's internal MASTERID alone

### Key Differences from Official Documentation

1. **Simplified Import Request Format**: The Postman collection examples use a cleaner `<IMPORTDATA>` wrapper structure instead of nested TDL/TDLMESSAGEs for simpler operations.
2. **REMOTEID Usage**: Heavily emphasized for idempotency and deletion operations (not as detailed in official docs).
3. **Practical Examples**: Real-world examples with DATE, NARRATION, and BANKALLOCATIONS that may not be in all official documentation samples.
4. **Action Pattern**: Confirms `ACTION="Create"`, `ACTION="Alter"`, `ACTION="Delete"` pattern (not explicitly named as such in some official docs).

### Content Type and Submission

- **Content-Type**: `text/xml` or `application/xml`
- **Encoding**: UTF-8 (default)
- **HTTP Method**: POST
- **Endpoint**: `http://localhost:9000` or `http://<server-ip>:9000`
- **cURL Example**: `curl -X POST -H "Content-Type: text/xml" --data @request.xml http://localhost:9000`

### Source and Accessibility

The workspace is publicly accessible but the Postman.com domain is blocked by some network proxies. The collection appears to be based on or referenced by:
- **GitHub Repository**: [puneetkeshav/tally-integration](https://github.com/puneetkeshav/tally-integration) - Contains 13 example XML files covering all major operations
- **Postman Documenter**: [Tally XMLS for Integration with Third party Apps](https://documenter.getpostman.com/view/13855108/TzeRpAMt)
- **TallyConnector Library**: [GitHub - Accounting-Companion/TallyConnector](https://github.com/Accounting-Companion/TallyConnector) - Abstracts the XML API with C# objects

---

## 12. Findings Not Verified

The following information could not be definitively verified from official sources during this research:

1. **Exact batch size limits** for XML imports (no official documentation found; general practice suggests 10-50 vouchers per batch)
2. **Specific HTTP timeout recommendations** for TallyPrime (standard HTTP timeouts apply; no TallyPrime-specific guidance found)
3. **Rate limiting policies** (no rate limits officially documented; assumed unlimited for business user patterns)
4. **Complete XML schema documentation** accessible via web search (Sample XML pages referenced but not directly accessible due to proxy blocks)
5. **Control character handling specifics** (&#4; mentioned in encoding but limited use cases documented)
6. **ODBC performance across network** from Linux/Mac clients (unsupported configuration; no metrics available)
7. **Full Postman collection direct access** - Postman.com and documenter.getpostman.com blocked by network proxy; collection details inferred from web search results and GitHub reference implementation

