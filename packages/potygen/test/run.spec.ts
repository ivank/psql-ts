import { Client } from 'pg';
import { maybeOne, one, sql, map } from '../src';
import { testDb } from './helpers';

let db: Client;

interface Query {
  params: {};
  result: { id: number };
}

const allSql = sql<Query>`SELECT id FROM all_types`;
const oneSql = sql<Query>`SELECT id FROM all_types WHERE id = $id`;
const otherSql = sql<Query>`SELECT 'TEST' || not_null AS t FROM all_types WHERE id = $id`;

describe('Template Tag', () => {
  beforeAll(async () => {
    db = testDb();
    await db.connect();
  });

  afterAll(() => db.end());

  it('Should select all', async () => {
    expect(await allSql(db, {})).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('Should select with params', async () => {
    expect(await oneSql(db, { id: 2 })).toEqual([{ id: 2 }]);
  });

  it('Should select maybe one', async () => {
    expect(await maybeOne(oneSql)(db, { id: 1 })).toEqual({ id: 1 });
  });

  it('Should select maybe one empty', async () => {
    expect(await maybeOne(oneSql)(db, { id: 1000 })).toEqual(undefined);
  });

  it('Should select only one', async () => {
    expect(await one(oneSql)(db, { id: 1 })).toEqual({ id: 1 });
  });

  it('Should select map', async () => {
    expect(await map((rows) => rows.map((item) => `!${item.id}`), allSql)(db, {})).toEqual(['!1', '!2']);
  });

  it('Should select more', async () => {
    expect(
      await map(async (rows, db) => await Promise.all(rows.map((item) => otherSql(db, { id: item.id }))), allSql)(
        db,
        {},
      ),
    ).toEqual([[{ t: 'TEST1' }], [{ t: 'TEST2' }]]);
  });

  it('Should select error if one empty', async () => {
    await expect(async () => {
      await one(oneSql)(db, { id: 1000 });
    }).rejects.toMatchObject({ message: 'Must return at least one' });
  });
});
