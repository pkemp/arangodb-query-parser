/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as qs from 'querystring';
import * as Moment from 'moment';
import * as _ from 'lodash';

export interface ParserOptions {
	dateFormat?: any;
	whitelist?: string[]; // list of fields allowed to be in the filter
	blacklist?: string[]; // list of fields disallowed to be in the filter
	casters?: { [key: string]: (val: string) => any };
	castParams?: { [key: string]: string };
	populateAlways?: string;
	populateMapping?: { [key: string]: string | { collection: string; field: string; as: string } };
	collection?: string;
	// rename the keys
	fieldsKey?: string;
	populateKey?: string;
	sortKey?: string;
	limitKey?: string;
	filterKey?: string;
	aggregateKey?: string;
}

export interface QueryOptions {
	filter: any;
	sort?: string | Record<string, any>;
	limit?: string;
	fields?: string | Record<string, any>;
	aggregate: { coll: string; agg: string; fields: string };
	populate?: { path: string; fields: string[] }[]; // path(s) to populate:  string array of path names or array like: [{path: 'model1', fields: ['p1', 'p2']}, ...]
}

export class ArangoDbQueryParser {
	private readonly _defaultDateFormat = [Moment.ISO_8601];

	private readonly _builtInCaster = {
		string: val => String(val),
		date: val => {
			const m = Moment.utc(val, this._options.dateFormat);
			if (m.isValid()) {
				return m.toDate();
			} else {
				throw new Error(`Invalid date string: [${val}]`);
			}
		},
	};

	private readonly _operators = [
		{ operator: 'fields', method: this.castFields, defaultKey: 'fields' },
		{ operator: 'populate', method: this.castPopulate, defaultKey: 'populate' },
		{ operator: 'sort', method: this.castSort, defaultKey: 'sort' },
		{ operator: 'limit', method: this.castLimit, defaultKey: 'limit' },
		{ operator: 'filter', method: this.castFilter, defaultKey: 'filter' },
		{ operator: 'aggregate', method: this.castAggregate, defaultKey: 'aggregate' },
	];

	constructor(private _options: ParserOptions = {}) {
		// add default date format as ISO_8601
		this._options.dateFormat = _options.dateFormat || this._defaultDateFormat;

		// add builtInCaster
		this._options.casters = Object.assign(this._builtInCaster, _options.casters);

		// build blacklist
		this._options.blacklist = _options.blacklist || [];
		this._operators.forEach(({ operator, defaultKey }) => {
			this._options.blacklist.push(this._options[`${operator}Key`] || defaultKey);
		});
	}

	/**
	 * parses query string/object to QueryOptions
	 * @param {string | Object} query
	 * @param {Object} [context]
	 * @return {string}
	 */
	parse(query: string | Record<string, any>, context?: Record<string, any>): QueryOptions {
		const params = _.isString(query) ? qs.parse(query) : query;
		const options = this._options;
		let result = {
			fields: 'o',
		};

		this._operators.forEach(({ operator, method, defaultKey }) => {
			const key = options[`${operator}Key`] || defaultKey;
			const value = params[key];

			if (value || operator === 'filter' || (operator === 'populate' && options.populateAlways)) {
				result[operator] = method.call(this, value, params);
			}
		}, this);

		result = this.parsePredefinedQuery(result, context);

		return result as QueryOptions;
	}

	/**
	 * parses query string/object to ArangoDB query
	 * @param {string | Object} query
	 * @param {Object} [context]
	 * @return {string}
	 */
	parseQuery(query: string | Record<string, any>, context?: Record<string, any>): string {
		const result = this.parse(query, context);
		return this.createQuery(result);
	}

	/**
	 * create AQL query from QueryOptions
	 * @param qo QueryOptions
	 * @return {string} AQL query
	 */
	createQuery(qo: QueryOptions): string {
		const options = this._options;
		let result = 'FOR o IN ' + options.collection;
		result += qo.filter.filters ? ' ' + qo.filter.filters : '';
		result += qo.sort ? ' ' + qo.sort : '';
		result += qo.limit ? ' ' + qo.limit : '';
		let ret = qo.aggregate ? ' ' + qo.aggregate.fields : qo.fields;
		const retOrig = ret;
		if (qo.populate && options.populateMapping) {
			qo.populate.forEach(({ path, fields }) => {
				const target = options.populateMapping[path];
				if (target) {
					const collection = target instanceof Object ? target.collection || target : target;
					const idField = target instanceof Object ? target.field || '_id' : '_id';
					const as = target instanceof Object ? target.as || path : path;
					if (ret == retOrig) {
						ret = 'MERGE(' + retOrig;
					}
					const select = fields
						? fields.reduce((prev, curr, _i, _a) => {
								return prev + (prev == '{ ' ? '' : ', ') + curr + ': ' + collection + '.' + curr;
						  }, '{ ') + ' }'
						: collection;
					result += ` LET ${path}${collection} = (FOR ${collection} IN ${collection} FILTER o.${path} == ${collection}.${idField} RETURN ${select}) `;
					result += ` FOR ${collection}Join IN (LENGTH(${path}${collection}) > 0 ? ${path}${collection} : [{}]) `;
					if (qo.aggregate) {
						qo.aggregate.coll = (qo.aggregate.coll ? qo.aggregate.coll + ', ' : '') + `o_${path}${collection} = ${path}${collection} `;
						ret += `, { ${as}: FIRST(o_${path}${collection}) }`;
					} else {
						ret += `, { ${as}: FIRST(${path}${collection}) }`;
					}
				}
			});
			if (ret != retOrig) {
				ret += ')';
			}
		}
		result += qo.aggregate ? ' COLLECT ' + (qo.aggregate.coll || '') + ' ' + qo.aggregate.agg : '';
		result += ' RETURN ' + ret;
		return result;
	}

	/**
	 * parses string to typed values
	 * This methods will apply auto type casting on Number, RegExp, Date, Boolean and null
	 * Also, it will apply defined casters in given options of the instance
	 * @param {string} value
	 * @param {string} key
	 * @return {any} typed value
	 */
	parseValue(value: string, key?: string): any {
		const options = this._options;

		// Apply casters
		// Match type casting operators like: string(true), _caster(123), $('test')
		const casters = options.casters;
		const casting = value.match(/^([a-zA-Z_$][0-9a-zA-Z_$]*)\((.*)\)$/);
		if (casting && casters[casting[1]]) {
			return casters[casting[1]](casting[2]);
		}

		// Apply casters per params
		if (key && options.castParams && options.castParams[key] && casters[options.castParams[key]]) {
			return casters[options.castParams[key]](value);
		}

		// cast array
		if (value.includes(',')) {
			return value.split(',').map(val => this.parseValue(val, key));
		}

		// Apply type casting for Number, RegExp, Date, Boolean and null
		// Match regex operators like /foo_\d+/i
		const regex = value.match(/^\/(.*)\/(i?)$/);
		if (regex) {
			return new RegExp(regex[1], regex[2]);
		}

		// Match boolean values
		if (value === 'true') {
			return true;
		}
		if (value === 'false') {
			return false;
		}

		// Match null
		if (value === 'null') {
			return null;
		}

		// Match numbers (string padded with zeros are not numbers)
		if (value !== '' && !isNaN(Number(value)) && !/^0[0-9]+/.test(value)) {
			return Number(value);
		}

		return value;
	}

	castFilter(filter, params): any {
		const options = this._options;
		const parsedFilter = filter ? this.parseFilter(filter) : {};
		return (
			Object.keys(params)
				.map(val => {
					const join = params[val] ? `${val}=${params[val]}` : val;
					// Separate key, operators and value
					const [, prefix, key, op, value] = join.match(/(!?)([^><!=]+)([><]=?|!?=|)(.*)/);
					return { prefix, key, op: this.parseOperator(op), value: this.parseValue(value, key) };
				})
				.filter(({ key }) => !options.whitelist || options.whitelist.indexOf(key) > -1)
				.filter(({ key }) => options.blacklist.indexOf(key) === -1)
				// eslint-disable-next-line @typescript-eslint/no-unused-vars
				.reduce((result, { prefix, key, op, value }) => {
					if (Array.isArray(value)) {
						op = op == '!=' ? 'NOT IN' : 'IN';
					} else if (value instanceof RegExp) {
						op = op == '!=' ? '!~' : '=~';
					}
					result.filters = typeof result.filters == 'string' ? result.filters + ' AND ' : 'FILTER ';
					result.filters += 'o.' + key + ' ' + op + ' @' + key;
					result.bindVars = !result.bindVars ? {} : result.bindVars;
					result.bindVars[key] = value;

					return result;
				}, parsedFilter)
		);
	}

	parseFilter(filter) {
		try {
			if (typeof filter === 'object') {
				return filter;
			}
			return JSON.parse(filter);
		} catch (err) {
			throw new Error(`Invalid JSON string: ${filter}`);
		}
	}

	parseOperator(operator) {
		if (operator === '=') {
			return '==';
		} else if (operator === '!=') {
			return '!=';
		} else if (operator === '>') {
			return '>';
		} else if (operator === '>=') {
			return '>=';
		} else if (operator === '<') {
			return '<';
		} else if (operator === '<=') {
			return '<=';
		} else if (!operator) {
			return '!';
		}
	}

	/**
	 * cast fields query to list of fields
	 * fields=email,phone
	 * =>
	 * { email: o.email, phone: o.phone }
	 * @param val
	 */
	castFields(val): string {
		const options = this._options;
		const result = val
			.split(',')
			.map(field => {
				const [p, s] = field.split('.', 2);
				return s ? { path: p, fields: s } : { path: p };
			})
			.filter(({ path }) => !options.whitelist || options.whitelist.indexOf(path) > -1)
			.filter(({ path }) => options.blacklist.indexOf(path) === -1)
			.reduce((result, curr, _key) => {
				const path = curr.path;
				//const fields = curr.fields;
				result += (result == '' ? '' : ', ') + path + ': o.' + path;
				return result;
			}, '');
		return '{ ' + result + ' }';
	}

	/**
	 * cast populate query to object like:
	 * populate=model1.p1,model1.p2,model2
	 * =>
	 * [{path: 'model1', fields: ['p1', 'p2']}, {path: 'model2'}]
	 * @param val
	 */
	castPopulate(val: string) {
		const options = this._options;
		const combined = options.populateAlways ? options.populateAlways + (val ? ',' + val : '') : val;
		return combined
			.split(',')
			.map(qry => {
				const [p, s] = qry.split('.', 2);
				return s ? { path: p, fields: [s] } : { path: p };
			})
			.reduce((prev, curr, _key) => {
				// consolidate population array
				const path = curr.path;
				const fields = curr.fields;
				let found = false;
				prev.forEach(e => {
					if (e.path === path) {
						found = true;
						if (fields) {
							if (e.fields) {
								e.fields.push(...fields);
							} else {
								e.fields = [fields];
							}
						}
					}
				});
				if (!found) {
					prev.push(curr);
				}
				return prev;
			}, []);
	}

	/**
	 * cast sort query to string
	 *
	 * @param sort
	 */
	castSort(sort: string) {
		const arr = _.isString(sort) ? sort.split(',') : sort;
		const r: Array<any> = arr.map(x => x.match(/^(\+|-)?(.*)/));

		return r.reduce((result, [, dir, key]) => {
			if (key && /^[a-zA-Z0-9_]*$/.test(key)) {
				result = (_.isString(result) && result != '' ? result + ', o.' : 'SORT o.') + key.trim() + (dir === '-' ? ' DESC' : '');
			}
			return result;
		}, '');
	}

	/**
	 * cast aggregate query to string
	 * aggregate=country,city:totalPrice sum price,averagePrice avg price,priceCount count price
	 * =>
	 * COLLECT country=o.country, city = o.city
	 * AGGREGATE totalPrice = SUM(o.price), averagePrice = AVG(o.price), priceCount = COUNT(o.price)
	 * @param aggregate
	 */
	castAggregate(aggregate: string) {
		let [collFields, aggregations] = aggregate.split(':', 2);
		let coll;
		let agg;
		let fields;
		const types = ['avg', 'sum', 'min', 'max', 'length', 'stddev', 'variance', 'count', 'count_distinct', 'unique', 'sorted_unique'];

		if (!collFields && !aggregations) {
			return '';
		}

		if (!aggregations) {
			aggregations = collFields;
			collFields = '';
		}

		for (const field of collFields.split(',')) {
			if (field && /^[a-zA-Z0-9_]*$/.test(field)) {
				coll = (coll ? coll + ', ' : '') + field + ' = o.' + field;
				fields = (fields ? fields + ', ' : '') + field;
			}
		}
		for (const a of aggregations.split(',')) {
			const [as, type, field] = a.split(' ');
			if (as && type && field && /^[a-zA-Z0-9_]*$/.test(as) && /^[a-zA-Z0-9_]*$/.test(field) && types.includes(type)) {
				agg = (agg ? agg + ', ' : 'AGGREGATE ') + as + ' = ' + type.toUpperCase() + '(o.' + field + ')';
				fields = (fields ? fields + ', ' : '') + as;
			}
		}

		return { coll, agg, fields: '{ ' + fields + ' }' };
	}

	/**
	 * cast limit query to object like
	 * limit=10
	 * =>
	 * LIMIT 10
	 * @param limit
	 */
	castLimit(limit: string) {
		const val = limit.split(',', 2);
		return 'LIMIT ' + (val.length > 1 ? Number(val[1]) + ', ' : '') + (val[0] == '' ? 1000000 : Number(val[0]));
	}

	/**
	 * transform predefined query strings defined in query string to the actual query object out of the given context
	 * @param query
	 * @param context
	 */
	parsePredefinedQuery(query, context?: Record<string, any>) {
		if (context) {
			// check if given string is the format as predefined query i.e. ${query}
			const _match = str => {
				const reg = /^\$\{([a-zA-Z_$][0-9a-zA-Z_$]*)\}$/;
				const match = str.match(reg);
				let val = undefined;
				if (match) {
					val = _.property(match[1])(context);
					if (val === undefined) {
						throw new Error(`No predefined query found for the provided reference [${match[1]}]`);
					}
				}
				return { match: !!match, val: val };
			};
			const _transform = obj => {
				return _.reduce(
					obj,
					(prev, curr, key) => {
						let val = undefined,
							match = undefined;
						if (_.isString(key)) {
							({ match, val } = _match(key));
							if (match) {
								if (_.has(curr, '$exists')) {
									// 1). as a key: {'${qry}': {$exits: true}} => {${qry object}}
									return _.merge(prev, val);
								} else if (_.isString(val)) {
									// 1). as a key: {'${qry}': 'something'} => {'${qry object}': 'something'}
									key = val;
								} else {
									throw new Error(`Invalid query string at ${key}`);
								}
							}
						}
						if (_.isString(curr)) {
							({ match, val } = _match(curr));
							if (match) {
								_.isNumber(key)
									? (prev as any).push(val) // 3). as an item of array: ['${qry}', ...] => [${qry object}, ...]
									: (prev[key] = val); // 2). as a value: {prop: '${qry}'} => {prop: ${qry object}}
								return prev;
							}
						}
						if (_.isObject(curr) && !_.isRegExp(curr) && !_.isDate(curr)) {
							// iterate all props & keys recursively
							_.isNumber(key) ? (prev as any).push(_transform(curr)) : (prev[key] = _transform(curr));
						} else {
							_.isNumber(key) ? (prev as any).push(curr) : (prev[key] = curr);
						}
						return prev;
					},
					_.isArray(obj) ? [] : {}
				);
			};
			return _transform(query);
		}
		return query;
	}
}
