# arangodb-query-parser

Convert url query string to ArangoDB database AQL query.

## Features

Supports most of the ArangoDB operators and features including filters, sorting, limit, skip.

## Installation
```
npm install arangodb-query-parser
```

## Usage

### API
```
import { ArangoDbQueryParser } from 'arangodb-query-parser';

const parser = new ArangoDbQueryParser(options?: ParserOptions)
const queryOptions = parser.parse(query: string, predefined: any) : QueryOptions

parser.createQuery(queryOptions);
```

### Constructor
Initialize parser with given options.

#### Arguments
- `ParserOptions`: Object for advanced options:
	- `dateFormat`: Date format, default is ISO-8601 (YYYY-MM-DD)
	- `whitelist`: String array of fields allowed to be in the filter
	- `blacklist`: String array of fields disallowed to be in the filter
	- `casters`: Custom casters
	- `castParams`: Caster parameters
	- `collection`: Name of the collection for query
	- `selectKey`: Name of the query parameter used for selected fields
	- `sortKey`: Name of the query parameter used for sorting
	- `limitKey`: Name of the query parameter for result count limit and skip
	- `filterKey`: Name of the query parameter for filters

### parser.parse(query, predefined)

Parses the query parameters into a QueryOptions object.

#### Arguments
- `query`: query string part of the requested API URL (ie, `firstName=John&limit=10`). [required]
- `predefined`: object for predefined queries/string templates [optional]

#### Returns
- `QueryOptions`: object contains the following properties:
    - `filter.filters` contains the query string
    - `filter.bindVars` contains the query binding values
    - `select` contains the query projection
    - `sort`, 
	- `limit`  contains the cursor modifiers for paging purposes.

### parser.createQuery(queryOptions)

#### Arguments
- `queryOptions`: query options created by parse method. [required]

#### Returns
- `query`: AQL query (as string) created from the query options. This can be used together with queryoptions filter.bindVars to run the query in ArangoDB.


## License
[MIT](LICENSE)

## Thanks

This library is heavily based on [mongoose-query-parser](https://github.com/leodinas-hao/mongoose-query-parser) by Leodinas Hao
