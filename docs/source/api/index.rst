API Reference
=============

The API documentation is generated from Doxygen XML. Ensure ``doxygen Doxyfile`` has been run before building Sphinx so Breathe can locate ``docs/xml``.

.. ifconfig:: have_doxygen

   .. doxygenfile:: src/configuration.ts
      :project: VSCode-Logger

   .. doxygenfile:: src/deviceTree.ts
      :project: VSCode-Logger

   .. doxygenfile:: src/extension.ts
      :project: VSCode-Logger

   .. doxygenfile:: src/hostEndpoints.ts
      :project: VSCode-Logger

   .. doxygenfile:: src/logPanel.ts
      :project: VSCode-Logger

   .. doxygenfile:: src/logSession.ts
      :project: VSCode-Logger

   .. doxygenfile:: src/passwordManager.ts
      :project: VSCode-Logger

   .. doxygenfile:: src/sshCommandRunner.ts
      :project: VSCode-Logger

   .. doxygenfile:: src/sshTerminal.ts
      :project: VSCode-Logger

   .. doxygenfile:: src/ssh2.d.ts
      :project: VSCode-Logger

   .. doxygenfile:: media/loggerPanel.js
      :project: VSCode-Logger

   .. doxygenfile:: media/sidebarView.js
      :project: VSCode-Logger

   .. doxygenfile:: media/sftpExplorer.js
      :project: VSCode-Logger

   .. doxygenfile:: src/sftpExplorer.ts
      :project: VSCode-Logger

   .. doxygenfile:: src/sidebarView.ts
      :project: VSCode-Logger

.. ifconfig:: not have_doxygen

   .. note::

      Doxygen XML was not found at ``docs/xml``. Run ``doxygen Doxyfile``
      before building the docs to generate the API reference.
