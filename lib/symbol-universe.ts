// The fixed symbol universe for this slice: a static list of NSE-listed
// large-cap equities plus the three headline indices. This is seed data for
// the `symbols` table (see db/seed.ts) - the application never searches or
// fetches this list from anywhere at runtime, and there is no general
// stock-search feature. `providerSymbol` follows Yahoo Finance's NSE ticker
// convention (`<SYMBOL>.NS`, `^NSEI`, ...) since that is the approved future
// market-data source, even though this slice never calls it.

export type SymbolKind = "EQUITY" | "INDEX";

export type SymbolSeed = {
  symbol: string;
  name: string;
  kind: SymbolKind;
  providerSymbol: string;
};

const equities: Array<[symbol: string, name: string]> = [
  ["RELIANCE", "Reliance Industries Ltd"],
  ["TCS", "Tata Consultancy Services Ltd"],
  ["HDFCBANK", "HDFC Bank Ltd"],
  ["ICICIBANK", "ICICI Bank Ltd"],
  ["INFY", "Infosys Ltd"],
  ["HINDUNILVR", "Hindustan Unilever Ltd"],
  ["ITC", "ITC Ltd"],
  ["SBIN", "State Bank of India"],
  ["BHARTIARTL", "Bharti Airtel Ltd"],
  ["KOTAKBANK", "Kotak Mahindra Bank Ltd"],
  ["LT", "Larsen & Toubro Ltd"],
  ["AXISBANK", "Axis Bank Ltd"],
  ["BAJFINANCE", "Bajaj Finance Ltd"],
  ["ASIANPAINT", "Asian Paints Ltd"],
  ["MARUTI", "Maruti Suzuki India Ltd"],
  ["HCLTECH", "HCL Technologies Ltd"],
  ["SUNPHARMA", "Sun Pharmaceutical Industries Ltd"],
  ["TITAN", "Titan Company Ltd"],
  ["ULTRACEMCO", "UltraTech Cement Ltd"],
  ["WIPRO", "Wipro Ltd"],
  ["NESTLEIND", "Nestle India Ltd"],
  ["ONGC", "Oil & Natural Gas Corporation Ltd"],
  ["NTPC", "NTPC Ltd"],
  ["POWERGRID", "Power Grid Corporation of India Ltd"],
  ["M&M", "Mahindra & Mahindra Ltd"],
  ["TATAMOTORS", "Tata Motors Ltd"],
  ["TATASTEEL", "Tata Steel Ltd"],
  ["JSWSTEEL", "JSW Steel Ltd"],
  ["ADANIENT", "Adani Enterprises Ltd"],
  ["ADANIPORTS", "Adani Ports and Special Economic Zone Ltd"],
  ["COALINDIA", "Coal India Ltd"],
  ["BAJAJFINSV", "Bajaj Finserv Ltd"],
  ["HDFCLIFE", "HDFC Life Insurance Company Ltd"],
  ["SBILIFE", "SBI Life Insurance Company Ltd"],
  ["DRREDDY", "Dr. Reddy's Laboratories Ltd"],
  ["CIPLA", "Cipla Ltd"],
  ["DIVISLAB", "Divi's Laboratories Ltd"],
  ["GRASIM", "Grasim Industries Ltd"],
  ["BRITANNIA", "Britannia Industries Ltd"],
  ["EICHERMOT", "Eicher Motors Ltd"],
  ["HEROMOTOCO", "Hero MotoCorp Ltd"],
  ["BAJAJ-AUTO", "Bajaj Auto Ltd"],
  ["TECHM", "Tech Mahindra Ltd"],
  ["INDUSINDBK", "IndusInd Bank Ltd"],
  ["UPL", "UPL Ltd"],
  ["APOLLOHOSP", "Apollo Hospitals Enterprise Ltd"],
  ["BPCL", "Bharat Petroleum Corporation Ltd"],
  ["HINDALCO", "Hindalco Industries Ltd"],
  ["SHREECEM", "Shree Cement Ltd"],
  ["TATACONSUM", "Tata Consumer Products Ltd"],
  ["LTIM", "LTIMindtree Ltd"],
];

const indices: Array<[symbol: string, name: string, providerSymbol: string]> = [
  ["NIFTY50", "Nifty 50", "^NSEI"],
  ["NIFTYBANK", "Nifty Bank", "^NSEBANK"],
  ["SENSEX", "S&P BSE Sensex", "^BSESN"],
];

export const SYMBOL_UNIVERSE: SymbolSeed[] = [
  ...equities.map(([symbol, name]) => ({
    symbol,
    name,
    kind: "EQUITY" as const,
    providerSymbol: `${symbol}.NS`,
  })),
  ...indices.map(([symbol, name, providerSymbol]) => ({
    symbol,
    name,
    kind: "INDEX" as const,
    providerSymbol,
  })),
];
