import {
  DendronError,
  DEngineV2,
  DNodeUtilsV2,
  ENGINE_ERROR_CODES,
  NoteUtilsV2,
  SchemaModulePropsV2,
  SchemaUtilsV2,
} from "@dendronhq/common-all";
import {
  createLogger,
  note2File,
  schemaModule2File,
} from "@dendronhq/common-server";
import {
  EngineTestUtilsV2,
  NodeTestUtilsV2,
} from "@dendronhq/common-test-utils";
import fs from "fs-extra";
import _ from "lodash";
import path from "path";
import { FileStorageV2 } from "../drivers/file/storev2";
import { DendronEngine } from "../enginev2";

describe("engine, schema", () => {
  let vaultDir: string;
  let engine: DEngineV2;
  let logger = createLogger("enginev2.spec");

  const createSchemaModule = async (rootName: string = "foo") => {
    const foo = SchemaUtilsV2.create({
      fname: `${rootName}`,
      id: `${rootName}`,
      parent: "root",
      created: "1",
      updated: "1",
      children: ["ch1"],
    });
    const ch1 = SchemaUtilsV2.create({
      fname: `${rootName}`,
      id: "ch1",
      created: "1",
      updated: "1",
    });
    const schemaModuleProps: [SchemaModulePropsV2, string][] = [
      [
        SchemaUtilsV2.createModule({
          version: 1,
          schemas: [foo, ch1],
        }),
        `${foo}`,
      ],
    ];
    await Promise.all(
      schemaModuleProps.map((ent) => {
        const [module, fname] = ent;
        return schemaModule2File(module, vaultDir, fname);
      })
    );
    return schemaModuleProps[0][0];
  };

  describe("basics", () => {
    beforeEach(async () => {
      vaultDir = await EngineTestUtilsV2.setupVault({
        initDirCb: async (dirPath: string) => {
          await NodeTestUtilsV2.createSchemas(dirPath, []);
        },
      });
      engine = new DendronEngine({
        vaults: [vaultDir],
        forceNew: true,
        store: new FileStorageV2({ vaults: [vaultDir], logger }),
        mode: "fuzzy",
        logger,
      });
    });

    test("no root", async () => {
      fs.removeSync(path.join(vaultDir, "root.schema.yml"));
      const { error } = (await engine.init()) as { error: DendronError };
      expect(error.status).toEqual(ENGINE_ERROR_CODES.NO_SCHEMA_FOUND);
    });

    test("only root", async () => {
      const { data } = await engine.init();
      expect(data.schemas).toMatchSnapshot();
    });

    test("root and one schem", async () => {
      await createSchemaModule();
      await engine.init();
      expect(engine.schemas).toMatchSnapshot();
      expect(_.values(engine.schemas).length).toEqual(2);
      expect(_.values(engine.schemas["foo"].schemas).length).toEqual(2);
    });

    test("write schema to existing module", async () => {
      const module = await createSchemaModule();
      await engine.init();

      // update schema
      const moduleRoot = SchemaUtilsV2.getModuleRoot(module);
      const ch2 = SchemaUtilsV2.create({
        fname: "foo",
        id: "ch2",
        created: "1",
        updated: "1",
      });
      DNodeUtilsV2.addChild(moduleRoot, ch2);
      module.schemas.push(ch2);
      await engine.updateSchema(module);

      expect(engine.schemas).toMatchSnapshot();
      expect(_.values(engine.schemas).length).toEqual(2);
      expect(_.values(engine.schemas["foo"].schemas).length).toEqual(3);
    });

    test("write new module", async () => {
      await createSchemaModule();
      await engine.init();

      // update schema
      const moduleNew = await createSchemaModule("bar");
      await engine.writeSchema(moduleNew);

      expect(engine.schemas).toMatchSnapshot();
      expect(_.values(engine.schemas).length).toEqual(3);
      expect(_.values(engine.schemas["foo"].schemas).length).toEqual(2);
      expect(_.values(engine.schemas["bar"].schemas).length).toEqual(2);
    });
  });
});

describe.only("engine, notes", () => {
  let vaultDir: string;
  let engine: DEngineV2;
  let logger = createLogger("enginev2.spec");

  const createNotes = async (rootName: string = "foo") => {
    const foo = NoteUtilsV2.create({
      fname: `${rootName}`,
      id: `${rootName}`,
      created: "1",
      updated: "1",
      children: ["ch1"],
    });
    const ch1 = NoteUtilsV2.create({
      fname: `${rootName}.ch1`,
      id: `${rootName}.ch1`,
      created: "1",
      updated: "1",
    });
    await note2File(foo, vaultDir);
    await note2File(ch1, vaultDir);
    return { foo, ch1 };
  };

  describe("basics", () => {
    beforeEach(async () => {
      vaultDir = await EngineTestUtilsV2.setupVault({
        initDirCb: async (dirPath: string) => {
          await NodeTestUtilsV2.createSchemas(dirPath, []);
          await NodeTestUtilsV2.createNotes(dirPath, []);
        },
      });
      engine = new DendronEngine({
        vaults: [vaultDir],
        forceNew: true,
        store: new FileStorageV2({ vaults: [vaultDir], logger }),
        mode: "fuzzy",
        logger,
      });
    });

    test("no root", async () => {
      fs.removeSync(path.join(vaultDir, "root.md"));
      const { error } = (await engine.init()) as { error: DendronError };
      expect(error.status).toEqual(ENGINE_ERROR_CODES.NO_ROOT_NOTE_FOUND);
    });

    test("only root", async () => {
      const { data } = await engine.init();
      expect(data.notes).toMatchSnapshot();
    });

    test("bad parse ", async () => {
      fs.writeFileSync(path.join(vaultDir, "foo.md"), "---\nbar:\n--\nfoo");
      const { error } = (await engine.init()) as { error: DendronError };
      expect(JSON.stringify(error)).toMatchSnapshot();
      expect(error.status).toEqual(ENGINE_ERROR_CODES.BAD_PARSE_FOR_NOTE);
    });

    test("no parent", async () => {
      await note2File(NoteUtilsV2.create({ fname: "foo.ch1" }), vaultDir);
      const { data } = await engine.init();
      expect(_.values(engine.notes).length).toEqual(3);
      const stubNote = NoteUtilsV2.getNoteByFname("foo", engine.notes);
      expect(_.pick(stubNote, ["stub"])).toEqual({ stub: true });
    });

    test("root and two notes", async () => {
      await createNotes();
      await engine.init();
      expect(engine.notes).toMatchSnapshot();
      expect(_.values(engine.notes).length).toEqual(3);
    });

    // test("write schema to existing module", async () => {
    //   const module = await createSchemaModule();
    //   await engine.init();

    //   // update schema
    //   const moduleRoot = SchemaUtilsV2.getModuleRoot(module);
    //   const ch2 = SchemaUtilsV2.create({
    //     fname: "foo",
    //     id: "ch2",
    //     created: "1",
    //     updated: "1",
    //   });
    //   DNodeUtilsV2.addChild(moduleRoot, ch2);
    //   module.schemas.push(ch2);
    //   await engine.updateSchema(module);

    //   expect(engine.schemas).toMatchSnapshot();
    //   expect(_.values(engine.schemas).length).toEqual(2);
    //   expect(_.values(engine.schemas["foo"].schemas).length).toEqual(3);
    // });

    // test("write new module", async () => {
    //   await createSchemaModule();
    //   await engine.init();

    //   // update schema
    //   const moduleNew = await createSchemaModule("bar");
    //   await engine.writeSchema(moduleNew);

    //   expect(engine.schemas).toMatchSnapshot();
    //   expect(_.values(engine.schemas).length).toEqual(3);
    //   expect(_.values(engine.schemas["foo"].schemas).length).toEqual(2);
    //   expect(_.values(engine.schemas["bar"].schemas).length).toEqual(2);
    // });
  });
});