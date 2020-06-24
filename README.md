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
	- `populateMapping`: Field to collection mappings
	- `populateAlways`: Related collections/fields that are always populated
	- `fieldsKey`: Name of the query parameter used for selected fields
	- `populateKey`: Name of the query parameter used for reference population
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
    - `fields` contains the query projection
    - `populate` paths to populate
    - `sort`, 
	- `limit`  contains the cursor modifiers for paging purposes.

#### Populating
Two choices for relationship population exists:
1. "Hardcoded" population with option populateAlways and populateMapping.
2. Permissive population with option populateMapping and parsed parameter populate.

The option populateMapping is used for mapping allowed relationships (field to collection).

Option populateAlways can be used for specifying which relationships are always populated.

Example 1 - map field owner to collection users and field parent to collection customers:
```
const parser = new ArangoDbQueryParser({
	collection: 'customers',
	populateMapping: { owner: 'users', parent: 'customers' },
});
```

Then the query URL can specify which relationships to populate, for example:

```
?populate=owner,parent.name,parent.name2
```

will populate all fields from owner and fields name & name2 from parent.


Example 2 - map field owner to collection users and field parent to collection customers, specify that all fields from owner and name field from parent are always populated:
```
const parser = new ArangoDbQueryParser({
	collection: 'customers',
	populateMapping: { owner: 'users', parent: 'customers' },
	populateAlways: 'owner,parent.name'
});
```



### parser.createQuery(queryOptions)

#### Arguments
- `queryOptions`: query options created by parse method. [required]

#### Returns
- `query`: AQL query (as string) created from the query options. This can be used together with queryoptions filter.bindVars to run the query in ArangoDB.


## License
[MIT](LICENSE)

## Thanks

This library is heavily based on [mongoose-query-parser](https://github.com/leodinas-hao/mongoose-query-parser) by Leodinas Hao
