# Homebrew formula for YodaMan.
#
# This file lives here so it is versioned alongside the release it describes.
# To publish it, copy it into a tap repository named `Yoda-Man/homebrew-yodaman`
# as `Formula/yodaman.rb`; users then install with:
#
#     brew install Yoda-Man/yodaman/yodaman
#
# The url and sha256 must be updated on every release. `scripts/brew-formula.js`
# regenerates both from the published npm tarball so they cannot be typed wrong.
class Yodaman < Formula
  desc "Local-first workspace intelligence: semantic search, knowledge graph, spec drift"
  homepage "https://github.com/Yoda-Man/yodaman"
  url "https://registry.npmjs.org/yodaman/-/yodaman-0.5.5.tgz"
  sha256 "1205729eaa6ed4b02c7b2581f4a103d8d0d6190e96e79adaaf0e2f6e075d9ddf"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  def caveats
    <<~EOS
      YodaMan needs a local model runner and three companion tools.
      Install them with:

        yodaman setup

      Ollama is not installed automatically — it is a system service, so
      `yodaman setup` prints the command and leaves the decision to you.
    EOS
  end

  test do
    # This assertion depends on `yodaman --version` exiting rather than starting
    # the runtime. Until 0.5.6 it did the latter, so this block would have hung
    # rather than failed — see tests/interfaces/CliCommands.test.js.
    assert_match version.to_s, shell_output("#{bin}/yodaman --version")

    # And that help is help, not a running server.
    assert_match "yodaman setup", shell_output("#{bin}/yodaman --help")
  end
end
