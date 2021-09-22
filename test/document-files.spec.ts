import { Parser, ParserError } from '@ikerin/rd-parse';
import { SqlGrammar } from '../src/sql.grammar';
import { inspect } from 'util';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { convertTag } from '../src/query-interface';
import { Client } from 'pg';
import { loadQuery } from '../src/load-types';
import { sqlTs } from '../src/document';

const parser = Parser(SqlGrammar);
let db: Client;

describe('Load Files', () => {
  beforeAll(async () => {
    db = new Client({ database: 'sql-ast', user: 'sql-ast', password: 'dev-pass' });
    await db.connect();
  });

  afterAll(async () => {
    await db.end();
  });

  it.each(
    readdirSync(join(__dirname, 'sql')).map((filename) => [
      filename,
      readFileSync(join(__dirname, 'sql', filename), 'utf-8'),
    ]),
  )('Should convert complex sql %s', async (name, sql) => {
    try {
      const ast = parser(sql);
      const query = convertTag(ast);
      const loadedQuery = await loadQuery(db, query);
      const ts = sqlTs(loadedQuery.query);
      expect(ts).toMatchSnapshot(name);
    } catch (e) {
      if (e instanceof ParserError) {
        console.log(inspect(e, { depth: 15, colors: true }));
      }
      throw e;
    }
  });
});
