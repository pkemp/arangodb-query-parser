/* eslint-disable @typescript-eslint/no-explicit-any */
import { suite, test } from 'mocha-typescript';
import { assert } from 'chai';

import { ArangoDbQueryParser } from './';

@suite('Tester')
// eslint-disable-next-line @typescript-eslint/no-unused-vars
class Tester {
	@test('should parse general query')
	generalParse() {
		const parser = new ArangoDbQueryParser();
		const qry = 'date=2016-01-01&boolean=true&integer=10&regexp=/foobar/i&null=null&startTime>2020-06-16&type=note,task&limit=,10&sort=type,-startTime&select=startTime,endTime';
		const parsed = parser.parse(qry);
		console.log('parsed:', parsed);
		assert.isNotNull(parsed.filter);
		assert.isOk(parsed.filter.bindVars['boolean'] === true);
		assert.isOk(parsed.filter.bindVars['integer'] === 10);
		assert.isOk(parsed.filter.bindVars['regexp'] instanceof RegExp);
		assert.isOk(parsed.filter.bindVars['null'] === null);
	}

	@test('should parse query with string templates')
	generalParse2() {
		const parser = new ArangoDbQueryParser();
		const predefined = {
			vip: { name: { $in: ['Google', 'Microsoft', 'NodeJs'] } },
			sentStatus: 'sent',
		};
		const parsed = parser.parse('timestamp>2017-10-01&timestamp<2020-01-01&author.firstName=/frederick/i&limit=100,50&sort=-timestamp&select=name', predefined);
		assert.strictEqual(parsed.filter.filters, 'FILTER o.timestamp > @timestamp AND o.timestamp < @timestamp AND o.author.firstName =~ @author.firstName');
		assert.isOk(parsed.filter.bindVars['author.firstName'] instanceof RegExp);
		assert.isOk(parsed.limit == 'LIMIT 50, 100');
		assert.isNotNull(parsed.sort);
		assert.isNotNull(parsed.select);
	}

	@test('should parse built in casters')
	builtInCastersTest() {
		const parser = new ArangoDbQueryParser();
		const qry = 'key1=string(10)&key2=date(2017-10-01)&key3=string(null)';
		const parsed = parser.parse(qry);
		assert.isOk(typeof parsed.filter.bindVars['key1'] === 'string');
		assert.isOk(parsed.filter.bindVars['key2'] instanceof Date);
		assert.isOk(typeof parsed.filter.bindVars['key3'] === 'string');
	}

	@test('should parse only whitelist fields')
	parseWhitelist() {
		const parser = new ArangoDbQueryParser({ whitelist: ['firstName', 'lastName'] });
		const parsed = parser.parse('firstName=William&middleName=Frederick&lastName=Durst&password=secret');
		assert.isOk(parsed.filter.bindVars['firstName'] == 'William');
		assert.isUndefined(parsed.filter.bindVars['middleName']);
		assert.isOk(parsed.filter.bindVars['lastName'] == 'Durst');
		assert.isUndefined(parsed.filter.bindVars['password']);
	}

	@test('should create equal query for filters')
	parseQuery1() {
		const parser = new ArangoDbQueryParser({ collection: 'events' });
		const parsed = parser.parse('startTime>2020-06-16&private=false');
		const query = parser.createQuery(parsed);
		assert.equal(query, 'FOR o IN events FILTER o.startTime > @startTime AND o.private == @private RETURN o');
	}

	@test('should create equal query for filters, limit and sort')
	parseQuery2() {
		const parser = new ArangoDbQueryParser({ collection: 'events' });
		const parsed = parser.parse('startTime>2020-06-16&private=false&limit=10&sort=startTime');
		const query = parser.createQuery(parsed);
		assert.equal(query, 'FOR o IN events FILTER o.startTime > @startTime AND o.private == @private SORT o.startTime LIMIT 10 RETURN o');
	}
}
