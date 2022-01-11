import { parser } from '@potygen/ast';
import { Client } from 'pg';
import { loadQueryInterfacesData, toLoadedQueryInterface } from '../src/load';
import { toQueryInterface } from '@potygen/query';
import { LoadedData } from '../src';
import { testDb } from './helpers';

let db: Client;

describe('Query Interface', () => {
  beforeAll(async () => {
    db = testDb();
    await db.connect();
  });

  afterAll(() => db.end());

  it.each<[string, string]>([
    ['select where', `SELECT character_col FROM all_types WHERE integer_col > COALESCE($id, 2)`],
    ['function result single', `SELECT ABS(integer_col) FROM all_types`],
    ['function result double', `SELECT ABS(ABS(integer_col)) FROM all_types`],
    ['nested function guess type', `SELECT ABS(ARRAY_LENGTH(ARRAY_AGG(integer_col), 1)) FROM all_types GROUP BY id`],
    [
      'nested function explicit type',
      `SELECT ARRAY_LENGTH(ARRAY_AGG(integer_col), 1)::int[] FROM all_types GROUP BY id`,
    ],
    ['operators integer', `SELECT integer_col + integer_col AS "test1" FROM all_types WHERE id = $id`],
    ['operators string', `SELECT character_col + integer_col AS "test1" FROM all_types WHERE character_col = $text`],
    ['different result types', `SELECT * FROM all_types`],
    ['views types', `SELECT * FROM all_types_view`],
    ['enum', `SELECT 'Pending'::account_levelisation_state`],
    ['enum column', `SELECT state FROM account_levelisations`],
    ['simple', `SELECT id, character_col FROM all_types WHERE id = :id`],
    ['coalesce 1', `SELECT COALESCE(id, character_col) FROM all_types`],
    ['coalesce 2', `SELECT COALESCE(character_col, id) FROM all_types`],
    ['coalesce 3', `SELECT COALESCE(12, character_col, id) FROM all_types`],
    ['coalesce 4', `SELECT COALESCE(integer_col, character_col) FROM all_types`],
    ['composite type from table', `SELECT (item).supplier_id FROM all_types`],
    ['composite type from view', `SELECT (item).supplier_id FROM all_types_view`],
    ['parameter required', `SELECT character_col FROM all_types WHERE integer_col > $id!`],
    ['parameter coalesce', `SELECT character_col FROM all_types WHERE integer_col > COALESCE($id, 2)`],
    ['sum', `SELECT SUM(integer_col) FROM all_types`],
    [
      'Coalesce binary expression',
      `SELECT COALESCE(numeric_col,0) + COALESCE(numeric_col,0) as "totalPaymentWithVat" FROM all_types`,
    ],
  ])('Should convert %s sql (%s)', async (_, sql) => {
    const logger = { info: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const queryInterface = toQueryInterface(parser(sql).ast);
    const data = await loadQueryInterfacesData({ db, logger }, [queryInterface], []);
    const loadedQueryInterface = toLoadedQueryInterface(data)(queryInterface);

    expect(loadedQueryInterface).toMatchSnapshot();
  });

  it('Should load multple queries', async () => {
    const queryInterfaces = [
      `SELECT ABS(integer_col) FROM all_types`,
      `SELECT ABS(ABS(integer_col)) FROM all_types`,
      `SELECT ABS(ARRAY_LENGTH(ARRAY_AGG(integer_col), 1)) FROM all_types GROUP BY id`,
      `SELECT ARRAY_LENGTH(ARRAY_AGG(integer_col), 1)::int[] FROM all_types GROUP BY id`,
      `SELECT integer_col + integer_col AS "test1" FROM all_types WHERE id = $id`,
      `SELECT character_col + integer_col AS "test1" FROM all_types WHERE character_col = $text`,
      `SELECT * FROM all_types`,
      `SELECT 'Pending'::account_levelisation_state`,
      `SELECT state FROM account_levelisations`,
      `SELECT id, character_col FROM all_types WHERE id = :id`,
    ].map((sql) => {
      return toQueryInterface(parser(sql).ast);
    });
    const logger = { info: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const data = await loadQueryInterfacesData({ db, logger }, queryInterfaces, []);

    let individuallyLoaded: LoadedData[] = [];
    for (const query of queryInterfaces) {
      individuallyLoaded = await loadQueryInterfacesData({ db, logger }, [query], individuallyLoaded);
    }

    expect(data).toEqual(expect.arrayContaining(individuallyLoaded));
  });
});
