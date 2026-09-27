import { testPrivateEvidenceStorage } from "./BuildingDashboard";

const makeClient = ({ uploadError = null, downloadError = null, removeError = null } = {}) => {
  const upload = jest.fn().mockResolvedValue({ error: uploadError });
  const download = jest.fn().mockResolvedValue({ data: { size: 4 }, error: downloadError });
  const remove = jest.fn().mockResolvedValue({ error: removeError });
  const from = jest.fn(() => ({ upload, download, remove }));
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null }) },
    storage: { from },
    upload, download, remove,
  };
};

const image = { type: "image/png", size: 4 };

beforeEach(() => {
  Object.defineProperty(window, "crypto", { configurable: true, value: { randomUUID: () => "test-id" } });
});

test("private image test uploads, reads and removes the same object", async () => {
  const client = makeClient();
  await testPrivateEvidenceStorage(client, "building-1", image);
  const path = "owner-1/building-1/test-test-id";
  expect(client.storage.from).toHaveBeenCalledWith("wbp-private-evidence");
  expect(client.upload).toHaveBeenCalledWith(path, image, { contentType: "image/png", upsert: false });
  expect(client.download).toHaveBeenCalledWith(path);
  expect(client.remove).toHaveBeenCalledWith([path]);
});

test("private image test still removes an uploaded object if reading fails", async () => {
  const client = makeClient({ downloadError: { message: "read denied" } });
  await expect(testPrivateEvidenceStorage(client, "building-1", image)).rejects.toThrow("Private read failed: read denied");
  expect(client.remove).toHaveBeenCalledWith(["owner-1/building-1/test-test-id"]);
});

test("private image test rejects unsuitable files before accessing storage", async () => {
  const client = makeClient();
  await expect(testPrivateEvidenceStorage(client, "building-1", { type: "application/pdf", size: 4 }))
    .rejects.toThrow("Choose a JPG or PNG test image");
  expect(client.storage.from).not.toHaveBeenCalled();
});
