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
	collection?: string;
	// rename the keys
	selectKey?: string;
	//populateKey?: string;
	sortKey?: string;
	limitKey?: string;
	filterKey?: string;
	leanKey?: string;
}

export interface QueryOptions {
	filter: any;
	sort?: string | Record<string, any>; // ie.: { field: 1, field2: -1 }
	limit?: string;
	select?: string | Record<string, any>; // ie.: { field: 0, field2: 0 }
	//populate?: string | Record<string, any>; // path(s) to populate:  a space delimited string of the path names or array like: [{path: 'field1', select: 'p1 p2'}, ...]
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
		{ operator: 'select', method: this.castSelect, defaultKey: 'select' },
		//{ operator: 'populate', method: this.castPopulate, defaultKey: 'populate' },
		{ operator: 'sort', method: this.castSort, defaultKey: 'sort' },
		{ operator: 'limit', method: this.castLimit, defaultKey: 'limit' },
		{ operator: 'filter', method: this.castFilter, defaultKey: 'filter' },
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
			select: 'o',
		};

		this._operators.forEach(({ operator, method, defaultKey }) => {
			const key = options[`${operator}Key`] || defaultKey;
			const value = params[key];

			if (value || operator === 'filter') {
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

	createQuery(qo: QueryOptions): string {
		const options = this._options;
		let result = 'FOR o IN ' + options.collection;
		result += qo.filter.filters ? ' ' + qo.filter.filters : '';
		result += qo.sort ? ' ' + qo.sort : '';
		result += qo.limit ? ' ' + qo.limit : '';
		result += ' RETURN ' + qo.select;
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
	 * cast select query to list of fields
	 * select=email,phone
	 * =>
	 * { email: o.email, phone: o.phone }
	 * @param val
	 */
	castSelect(val): string {
		const result = val
			.split(',')
			.map(field => {
				const [p, s] = field.split('.', 2);
				return s ? { path: p, select: s } : { path: p };
			})
			// TODO: whitelist / blacklist here too
			.reduce((result, curr, _key) => {
				const path = curr.path;
				//const select = curr.select;
				result += (result == '' ? '' : ', ') + path + ': o.' + path;
				return result;
			}, '');
		return '{ ' + result + ' }';
	}

	/**
	 * cast populate query to object like:
	 * populate=field1.p1,field1.p2,field2
	 * =>
	 * [{path: 'field1', select: 'p1 p2'}, {path: 'field2'}]
	 * @param val
	 */
	castPopulate(val: string) {
		return val
			.split(',')
			.map(qry => {
				const [p, s] = qry.split('.', 2);
				return s ? { path: p, select: s } : { path: p };
			})
			.reduce((prev, curr, key) => {
				// consolidate population array
				const path = curr.path;
				const select = (curr as any).select;
				let found = false;
				prev.forEach(e => {
					if (e.path === path) {
						found = true;
						if (select) {
							e.select = e.select ? e.select + ' ' + select : select;
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
			result = (_.isString(result) && result != '' ? result + ', o.' : 'SORT o.') + key.trim() + (dir === '-' ? ' DESC' : '');
			return result;
		}, '');
	}

	/**
	 * cast limit query to object like
	 * limit=10
	 * =>
	 * {limit: 10}
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
