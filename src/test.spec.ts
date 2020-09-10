/* eslint-disable @typescript-eslint/no-explicit-any */
import { suite, test } from '@testdeck/mocha';
import { assert } from 'chai';

import { ArangoDbQueryParser } from './';

@suite('Tester')
// eslint-disable-next-line @typescript-eslint/no-unused-vars
class Tester {
	@test('should parse general query')
	generalParse() {
		const parser = new ArangoDbQueryParser();
		const qry =
			'date=2016-01-01&boolean=true&integer=10&regexp=/foobar/i&null=null&startTime>2020-06-16&type=note,task&limit=,10&sort=type,-startTime&fields=startTime,endTime';
		const parsed = parser.parse(qry);
		assert.isNotNull(parsed.filter);
		assert.isOk(parsed.filter.bindVars['boolean'] === true);
		assert.isOk(parsed.filter.bindVars['integer'] === 10);
		assert.isOk(parsed.filter.bindVars['regexp'] instanceof RegExp);
		assert.isOk(parsed.filter.bindVars['null'] === null);
	}

	@test('should parse more complex query')
	generalParse2() {
		const parser = new ArangoDbQueryParser();
		const parsed = parser.parse('timestamp>2017-10-01&timestamp<2020-01-01&author.firstName=/frederick/i&limit=100,50&sort=-timestamp&fields=name');
		assert.strictEqual(parsed.filter.filters, 'FILTER o.timestamp > @timestamp AND o.timestamp < @timestamp AND o.author.firstName =~ @author_firstName');
		assert.isOk(parsed.filter.bindVars['author_firstName'] instanceof RegExp);
		assert.isOk(parsed.limit == 'LIMIT 50, 100');
		assert.isNotNull(parsed.sort);
		assert.isNotNull(parsed.fields);
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

	@test('should not parse blacklisted fields')
	parseBlacklist() {
		const parser = new ArangoDbQueryParser({ blacklist: ['middleName', 'password'] });
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

	@test('should create equal query for dot notation filters')
	parseQuery3() {
		const parser = new ArangoDbQueryParser({ collection: 'documents' });
		const parsed = parser.parse('topLevel.secondLevel.thirdLevel=foo');
		const query = parser.createQuery(parsed);
		assert.equal(query, 'FOR o IN documents FILTER o.topLevel.secondLevel.thirdLevel == @topLevel_secondLevel_thirdLevel RETURN o');
	}

	@test('should create query only for whitelisted fields')
	parseQueryWhiteList() {
		const parser = new ArangoDbQueryParser({ collection: 'users', whitelist: ['firstName', 'lastName'] });
		const parsed = parser.parse('fields=firstName,middleName,lastName,password');
		const query = parser.createQuery(parsed);
		assert.equal(query, 'FOR o IN users RETURN { firstName: o.firstName, lastName: o.lastName }');
	}

	@test('should not create query for blacklisted fields')
	parseQueryBlacklist() {
		const parser = new ArangoDbQueryParser({ collection: 'users', blacklist: ['middleName', 'password'] });
		const parsed = parser.parse('fields=firstName,middleName,lastName,password');
		const query = parser.createQuery(parsed);
		assert.equal(query, 'FOR o IN users RETURN { firstName: o.firstName, lastName: o.lastName }');
	}

	@test('should create populate')
	parsePopulate1() {
		const parser = new ArangoDbQueryParser({ collection: 'customers', populateMapping: { owner: 'users', parent: 'customers' } });
		const parsed = parser.parse('populate=owner,parent.name,parent.name2');
		const query = parser.createQuery(parsed);
		assert.isOk(parsed.populate.length == 2);
		assert.isOk(parsed.populate[0].path == 'owner');
		assert.isOk(parsed.populate[1].path == 'parent');
		assert.isUndefined(parsed.populate[0].fields);
		assert.isDefined(parsed.populate[1].fields);
		assert.equal(
			query,
			'FOR o IN customers LET ownerusers = (FOR users IN users FILTER o.owner == users._id RETURN users)  FOR usersJoin IN (LENGTH(ownerusers) > 0 ? ownerusers : [{}])  LET parentcustomers = (FOR customers IN customers FILTER o.parent == customers._id RETURN { name: customers.name, name2: customers.name2 })  FOR customersJoin IN (LENGTH(parentcustomers) > 0 ? parentcustomers : [{}])  RETURN MERGE(o, { owner: FIRST(ownerusers) }, { parent: FIRST(parentcustomers) })'
		);
	}

	@test('should create default populate')
	parsePopulate2() {
		const parser = new ArangoDbQueryParser({
			collection: 'customers',
			populateMapping: { owner: 'users', parent: 'customers' },
			populateAlways: 'owner,parent.name',
		});
		const parsed = parser.parse('');
		const query = parser.createQuery(parsed);
		assert.isOk(parsed.populate.length == 2);
		assert.isOk(parsed.populate[0].path == 'owner');
		assert.isOk(parsed.populate[1].path == 'parent');
		assert.isUndefined(parsed.populate[0].fields);
		assert.isDefined(parsed.populate[1].fields);
		assert.equal(
			query,
			'FOR o IN customers LET ownerusers = (FOR users IN users FILTER o.owner == users._id RETURN users)  FOR usersJoin IN (LENGTH(ownerusers) > 0 ? ownerusers : [{}])  LET parentcustomers = (FOR customers IN customers FILTER o.parent == customers._id RETURN { name: customers.name })  FOR customersJoin IN (LENGTH(parentcustomers) > 0 ? parentcustomers : [{}])  RETURN MERGE(o, { owner: FIRST(ownerusers) }, { parent: FIRST(parentcustomers) })'
		);
	}

	@test('should create default populate with another name')
	parsePopulate3() {
		const parser = new ArangoDbQueryParser({
			collection: 'customers',
			populateMapping: { owner: { collection: 'users', field: '_key', as: 'ownerData' }, parent: 'customers' },
			populateAlways: 'owner,parent.name',
		});
		const parsed = parser.parse('');
		const query = parser.createQuery(parsed);
		assert.isOk(parsed.populate.length == 2);
		assert.isOk(parsed.populate[0].path == 'owner');
		assert.isOk(parsed.populate[1].path == 'parent');
		assert.isUndefined(parsed.populate[0].fields);
		assert.isDefined(parsed.populate[1].fields);
		assert.equal(
			query,
			'FOR o IN customers LET ownerusers = (FOR users IN users FILTER o.owner == users._key RETURN users)  FOR usersJoin IN (LENGTH(ownerusers) > 0 ? ownerusers : [{}])  LET parentcustomers = (FOR customers IN customers FILTER o.parent == customers._id RETURN { name: customers.name })  FOR customersJoin IN (LENGTH(parentcustomers) > 0 ? parentcustomers : [{}])  RETURN MERGE(o, { ownerData: FIRST(ownerusers) }, { parent: FIRST(parentcustomers) })'
		);
	}

	@test('should remove all default populates')
	parsePopulate4() {
		const parser = new ArangoDbQueryParser({
			collection: 'customers',
			populateMapping: { owner: 'users', parent: 'customers' },
			populateAlways: 'owner,parent.name,parent.name2',
		});
		const parsed = parser.parse('populate=-');
		const query = parser.createQuery(parsed);
		assert.isNull(parsed.populate);
		assert.equal(query, 'FOR o IN customers RETURN o');
	}

	@test('should remove specified default populates')
	parsePopulate5() {
		const parser = new ArangoDbQueryParser({
			collection: 'customers',
			populateMapping: { owner: 'users', parent: 'customers' },
			populateAlways: 'owner,parent.name,parent.name2',
		});
		const parsed = parser.parse('populate=-owner,-parent.name2');
		const query = parser.createQuery(parsed);
		assert.isOk(parsed.populate.length == 1);
		assert.isOk(parsed.populate[0].path == 'parent');
		assert.isDefined(parsed.populate[0].fields);
		assert.isOk(parsed.populate[0].fields.length == 1);
		assert.equal(
			query,
			'FOR o IN customers LET parentcustomers = (FOR customers IN customers FILTER o.parent == customers._id RETURN { name: customers.name })  FOR customersJoin IN (LENGTH(parentcustomers) > 0 ? parentcustomers : [{}])  RETURN MERGE(o, { parent: FIRST(parentcustomers) })'
		);
	}

	@test('should create grouped aggregates')
	parseAggregate1() {
		const parser = new ArangoDbQueryParser({ collection: 'deals' });
		const parsed = parser.parse('aggregate=owner,status:totalPrice sum sum,averagePrice avg sum,priceCount count sum');
		const query = parser.createQuery(parsed);
		assert.equal(
			query,
			'FOR o IN deals COLLECT owner = o.owner, status = o.status AGGREGATE totalPrice = SUM(o.sum), averagePrice = AVG(o.sum), priceCount = COUNT(o.sum) RETURN  { owner, status, totalPrice, averagePrice, priceCount }'
		);
	}

	@test('should create total aggregates')
	parseAggregate2() {
		const parser = new ArangoDbQueryParser({ collection: 'deals' });
		const parsed = parser.parse('aggregate=totalPrice sum sum,averagePrice avg sum,priceCount count sum');
		const query = parser.createQuery(parsed);
		assert.equal(
			query,
			'FOR o IN deals COLLECT  AGGREGATE totalPrice = SUM(o.sum), averagePrice = AVG(o.sum), priceCount = COUNT(o.sum) RETURN  { totalPrice, averagePrice, priceCount }'
		);
	}

	@test('should create aggregates with populate')
	parseAggregate3() {
		const parser = new ArangoDbQueryParser({
			collection: 'deals',
			populateMapping: { owner: 'users', customer: 'customers' },
			populateAlways: 'customer.name',
		});
		const parsed = parser.parse('aggregate=owner,status:totalPrice sum sum,averagePrice avg sum,priceCount count sum');
		const query = parser.createQuery(parsed);
		assert.equal(
			query,
			'FOR o IN deals LET customercustomers = (FOR customers IN customers FILTER o.customer == customers._id RETURN { name: customers.name })  FOR customersJoin IN (LENGTH(customercustomers) > 0 ? customercustomers : [{}])  COLLECT owner = o.owner, status = o.status, o_customercustomers = customercustomers  AGGREGATE totalPrice = SUM(o.sum), averagePrice = AVG(o.sum), priceCount = COUNT(o.sum) RETURN MERGE( { owner, status, totalPrice, averagePrice, priceCount }, { customer: FIRST(o_customercustomers) })'
		);
	}

	@test('should create aggregates grouped only by populates')
	parseAggregate4() {
		const parser = new ArangoDbQueryParser({
			collection: 'deals',
			populateMapping: { owner: 'users', customer: 'customers' },
			populateAlways: 'customer.name',
		});
		const parsed = parser.parse('aggregate=totalPrice sum sum,averagePrice avg sum,priceCount count sum');
		const query = parser.createQuery(parsed);
		assert.equal(
			query,
			'FOR o IN deals LET customercustomers = (FOR customers IN customers FILTER o.customer == customers._id RETURN { name: customers.name })  FOR customersJoin IN (LENGTH(customercustomers) > 0 ? customercustomers : [{}])  COLLECT o_customercustomers = customercustomers  AGGREGATE totalPrice = SUM(o.sum), averagePrice = AVG(o.sum), priceCount = COUNT(o.sum) RETURN MERGE( { totalPrice, averagePrice, priceCount }, { customer: FIRST(o_customercustomers) })'
		);
	}

	@test('should create aggregates without default populates')
	parseAggregate5() {
		const parser = new ArangoDbQueryParser({
			collection: 'deals',
			populateMapping: { owner: 'users', customer: 'customers' },
			populateAlways: 'customer.name',
		});
		const parsed = parser.parse('populate=-&aggregate=totalPrice sum sum,averagePrice avg sum,priceCount count sum');
		const query = parser.createQuery(parsed);
		assert.equal(
			query,
			'FOR o IN deals COLLECT  AGGREGATE totalPrice = SUM(o.sum), averagePrice = AVG(o.sum), priceCount = COUNT(o.sum) RETURN  { totalPrice, averagePrice, priceCount }'
		);
	}

	@test('should parse date shortcuts')
	parseDateShortcuts1() {
		const parser = new ArangoDbQueryParser({ collection: 'deals' });
		const parsed = parser.parse('thisYearStarts=date(startOfYear)&thisYearEnds=date(endOfYear)&thisMonthStarts=date(startOfMonth)&thisMonthEnds=date(endOfMonth)&thisQuarterStarts=date(startOfQuarter)&thisQuarterEnds=date(endOfQuarter)');
		const query = parser.createQuery(parsed);
		assert.equal(
			query,
			'FOR o IN deals FILTER o.thisYearStarts == @thisYearStarts AND o.thisYearEnds == @thisYearEnds AND o.thisMonthStarts == @thisMonthStarts AND o.thisMonthEnds == @thisMonthEnds AND o.thisQuarterStarts == @thisQuarterStarts AND o.thisQuarterEnds == @thisQuarterEnds RETURN o'
		);
	}

	@test('should parse date shortcuts with modifiers')
	parseDateShortcuts2() {
		const parser = new ArangoDbQueryParser({ collection: 'deals' });
		const parsed = parser.parse('previousYearStarts=date(startOfYear:-1)&previousYearEnds=date(endOfYear:-1)&nextMonthStarts=date(startOfMonth:1)&nextMonthEnds=date(endOfMonth:1)');
		const query = parser.createQuery(parsed);
		assert.equal(
			query,
			'FOR o IN deals FILTER o.previousYearStarts == @previousYearStarts AND o.previousYearEnds == @previousYearEnds AND o.nextMonthStarts == @nextMonthStarts AND o.nextMonthEnds == @nextMonthEnds RETURN o'
		);
	}
}
